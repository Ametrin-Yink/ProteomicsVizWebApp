"""GSEA caching service for performance optimization.

Caches GSEA results keyed by input data hash to avoid redundant computations.
"""

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Optional

from app.models.data import GSEAResults

logger = logging.getLogger("proteomics")


@dataclass(frozen=True)
class GSEACacheKey:
    """Immutable cache key for GSEA results."""
    key_hash: str

    @classmethod
    def create(
        cls,
        protein_ids: list[str],
        gene_names: list[str],
        conditions: tuple[str, str],
        database: str
    ) -> "GSEACacheKey":
        """Create a cache key from input parameters.

        The key is order-independent for protein_ids and gene_names
        to handle different input orderings.
        """
        # Sort to ensure order independence
        sorted_proteins = sorted(protein_ids)
        sorted_genes = sorted(gene_names)

        # Create deterministic string representation
        key_data = {
            "proteins": sorted_proteins,
            "genes": sorted_genes,
            "conditions": conditions,
            "database": database
        }
        key_string = json.dumps(key_data, sort_keys=True)

        # Hash the string
        key_hash = hashlib.sha256(key_string.encode()).hexdigest()

        return cls(key_hash=key_hash)


class GSEACacheService:
    """LRU cache for GSEA results."""

    def __init__(self, max_size: int = 100):
        """Initialize cache with max size."""
        self._max_size = max_size
        self._cache: dict[str, GSEAResults] = {}
        self._access_order: list[str] = []

    def get(self, key: GSEACacheKey) -> Optional[GSEAResults]:
        """Get cached result if exists."""
        if key.key_hash in self._cache:
            # Update access order (LRU)
            self._access_order.remove(key.key_hash)
            self._access_order.append(key.key_hash)
            logger.debug(f"GSEA cache HIT: {key.key_hash[:16]}...")
            return self._cache[key.key_hash]

        logger.debug(f"GSEA cache MISS: {key.key_hash[:16]}...")
        return None

    def store(self, key: GSEACacheKey, result: GSEAResults) -> None:
        """Store result in cache."""
        # Evict oldest if at capacity
        if len(self._cache) >= self._max_size and key.key_hash not in self._cache:
            oldest = self._access_order.pop(0)
            del self._cache[oldest]
            logger.debug(f"GSEA cache EVICT: {oldest[:16]}...")

        # Store new result
        self._cache[key.key_hash] = result
        if key.key_hash in self._access_order:
            self._access_order.remove(key.key_hash)
        self._access_order.append(key.key_hash)

        logger.debug(f"GSEA cache STORE: {key.key_hash[:16]}...")

    def clear(self) -> None:
        """Clear all cached results."""
        self._cache.clear()
        self._access_order.clear()

    def get_stats(self) -> dict:
        """Get cache statistics."""
        return {
            "size": len(self._cache),
            "max_size": self._max_size
        }


# Global instance
gsea_cache_service = GSEACacheService(max_size=100)
