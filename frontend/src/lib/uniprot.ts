/**
 * UniProt API client for fetching gene names by accession ID.
 */

export interface GeneNameResult {
  accession: string;
  geneName: string;
}

/**
 * Fetch gene names from UniProt REST API for a list of accession IDs.
 * Returns a record mapping accession to gene name (only for found entries).
 */
export async function fetchGeneNames(
  accessions: string[],
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  await Promise.all(
    accessions.map(async (accession) => {
      try {
        const res = await fetch(
          `https://rest.uniprot.org/uniprotkb/${accession}.json`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const geneName =
          data.genes?.[0]?.geneName?.value ??
          data.recommendedName?.fullName?.value;
        if (geneName) {
          results[accession] = geneName;
        }
      } catch {
        // Silently skip failures — UI falls back to accession display
      }
    }),
  );

  return results;
}
