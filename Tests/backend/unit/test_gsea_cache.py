import pytest
from app.services.gsea_cache_service import gsea_cache_service, GSEACacheKey


class TestGSEACacheService:
    def test_cache_key_generation(self):
        """Test that cache keys are generated consistently."""
        proteins = ["P123", "P456", "P789"]
        genes = ["GENE1", "GENE2", "GENE3"]
        conditions = ("Treatment", "Control")

        key1 = GSEACacheKey.create(proteins, genes, conditions, "GO_BP")
        key2 = GSEACacheKey.create(list(reversed(proteins)), genes, conditions, "GO_BP")

        assert key1.key_hash == key2.key_hash

    def test_cache_store_and_retrieve(self):
        """Test storing and retrieving cached results."""
        from app.models.data import GSEAResults, GSEAResult

        key = GSEACacheKey.create(["P1"], ["G1"], ("T", "C"), "GO_BP")
        result = GSEAResults(
            database="GO_BP",
            total_pathways=10,
            significant_pathways=5,
            overrepresented=3,
            underrepresented=2,
            results=[GSEAResult(term="test", name="Test Pathway", es=0.5, nes=1.5, pval=0.01, fdr=0.05, lead_genes=["G1"], matched_genes=1)]
        )

        gsea_cache_service.store(key, result)
        cached = gsea_cache_service.get(key)

        assert cached is not None
        assert cached.total_pathways == 10

    def test_cache_miss_returns_none(self):
        """Test that cache miss returns None."""
        key = GSEACacheKey.create(["P1"], ["G1"], ("T", "C"), "GO_BP")

        result = gsea_cache_service.get(key)

        assert result is None
