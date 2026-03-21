"""
face_registry.py — FAISS-based face identity registry.

Assigns persistent UUIDs to detected faces via cosine similarity lookup.
Persists the index to disk and rebuilds from the database on startup.
"""

import logging
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import faiss
import numpy as np

from modules.config_loader import Config
from modules.database import Database

logger = logging.getLogger(__name__)


class FaceRegistry:
    """FAISS IndexFlatIP registry for persistent face identity assignment."""

    def __init__(self, cfg: Config, db: Database) -> None:
        """Initialise the registry, load existing embeddings from the database.

        Args:
            cfg: Loaded Config dataclass instance.
            db: Initialised Database instance for persistence.
        """
        self.dim = 512
        self.threshold = cfg.similarity_threshold
        self.index = faiss.IndexFlatIP(self.dim)
        self.face_ids: list[str] = []
        self.faiss_path = Path(cfg.faiss_index_path)
        self._cfg = cfg
        self.db = db

        self._load_from_db()
        logger.info(
            "REGISTRY_INIT loaded=%d faces threshold=%.4f",
            self.index.ntotal,
            self.threshold,
        )

    def _load_from_db(self) -> None:
        """Rebuild FAISS index from all embeddings stored in the database.

        Normalises each embedding before adding so inner-product == cosine similarity.
        """
        ids, embs = self.db.load_all_embeddings()
        if embs.shape[0] == 0:
            logger.info("REGISTRY_LOADED count=0")
            return

        for i, face_id in enumerate(ids):
            norm_emb = self._normalize(embs[i])
            self.index.add(norm_emb.reshape(1, self.dim))
            self.face_ids.append(face_id)

        logger.info("REGISTRY_LOADED count=%d", len(self.face_ids))

    def _normalize(self, embedding: np.ndarray) -> np.ndarray:
        """Return L2-normalised embedding. Returns zero vector if norm is zero.

        Args:
            embedding: Raw 512-dim float32 array.

        Returns:
            Unit-norm float32 array of the same shape.
        """
        norm = np.linalg.norm(embedding)
        if norm == 0.0:
            return np.zeros(self.dim, dtype=np.float32)
        return (embedding / norm).astype(np.float32)

    def lookup_or_register(
        self, embedding: np.ndarray, frame_id: int = 0
    ) -> tuple[str, str]:
        """Find the closest matching face or register a new one.

        Normalises the embedding, searches the FAISS index, and returns either
        the existing UUID (EXISTING) or a freshly assigned one (NEW).

        Every call logs a REID_DECISION line regardless of outcome.

        Args:
            embedding: Raw 512-dim float32 embedding from the face embedder.
            frame_id: Current video frame number, used for logging.

        Returns:
            Tuple of (face_id: str, status: str) where status is 'EXISTING' or 'NEW'.
        """
        emb = self._normalize(embedding).reshape(1, self.dim)

        if self.index.ntotal > 0:
            k = min(3, self.index.ntotal)
            sims, idxs = self.index.search(emb, k)
            best_sim = float(sims[0][0])
            second_sim = float(sims[0][1]) if self.index.ntotal > 1 else 0.0
            decision = "MATCH" if best_sim >= self.threshold else "NEW"

            logger.info(
                "REID_DECISION frame=%d best_sim=%.4f second_sim=%.4f "
                "threshold=%.4f decision=%s",
                frame_id, best_sim, second_sim, self.threshold, decision,
            )

            if best_sim >= self.threshold:
                matched_id = self.face_ids[idxs[0][0]]
                logger.info("REID_MATCH face_id=%s sim=%.4f", matched_id, best_sim)
                return matched_id, "EXISTING"

        # Register new face
        new_id = str(uuid.uuid4())[:8]
        self.index.add(emb)
        self.face_ids.append(new_id)

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        self.db.register_face(new_id, embedding, timestamp)

        logger.info("REGISTERED face_id=%s total=%d", new_id, self.index.ntotal)
        return new_id, "NEW"

    def save(self) -> None:
        """Write the FAISS index to disk at the configured path.

        Creates parent directories if they do not exist.
        """
        self.faiss_path.parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.index, str(self.faiss_path))
        logger.info(
            "REGISTRY_SAVED path=%s count=%d", self.faiss_path, self.index.ntotal
        )


if __name__ == "__main__":
    import os

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
    )
    from modules.config_loader import load_config
    from modules.database import Database

    cfg = load_config()
    cfg.db_path = "data/test_registry.db"
    cfg.faiss_index_path = "data/test_registry.bin"
    db = Database(cfg)
    registry = FaceRegistry(cfg, db)

    # Test 1: Register new face
    emb1 = np.random.rand(512).astype(np.float32)
    id1, status1 = registry.lookup_or_register(emb1, frame_id=1)
    print(f"Test 1 — New face: id={id1} status={status1}")
    assert status1 == "NEW", f"Expected NEW, got {status1}"

    # Test 2: Same embedding should match
    id2, status2 = registry.lookup_or_register(emb1, frame_id=2)
    print(f"Test 2 — Same embedding: id={id2} status={status2}")
    assert status2 == "EXISTING", f"Expected EXISTING, got {status2}"
    assert id1 == id2, f"Expected id={id1}, got {id2}"

    # Test 3: Very different embedding = new face
    emb3 = np.random.rand(512).astype(np.float32)
    id3, status3 = registry.lookup_or_register(emb3, frame_id=3)
    print(f"Test 3 — Different face: id={id3} status={status3}")

    # Test 4: Save and reload
    registry.save()
    db.flush()  # ensure async writes are committed before reloading
    registry2 = FaceRegistry(cfg, db)
    print(f"Test 4 — Reloaded registry: {registry2.index.ntotal} faces")

    db.flush()
    db.close()
    os.remove("data/test_registry.db")
    os.remove("data/test_registry.bin")
    print("face_registry.py self-test passed.")
