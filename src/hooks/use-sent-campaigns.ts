import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCampaigns, type Campaign } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";

const PAGES = 5; // the 500 most recent campaigns is plenty of history for trend analysis

// Loads recent campaigns once and shares them across every analysis tab.
export function useCampaignHistory() {
  const fetchSettings = useServerFn(getSettings);
  const fetchCampaigns = useServerFn(listCampaigns);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });

  const campaignsQ = useQuery({
    queryKey: ["campaigns-history", PAGES],
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const all: Campaign[] = [];
      for (let p = 0; p < PAGES; p++) {
        const res = await fetchCampaigns({ data: { offset: p * 100 } });
        all.push(...res.campaigns);
        if (all.length >= res.total || res.campaigns.length === 0) break;
      }
      return all;
    },
  });

  return {
    campaigns: campaignsQ.data,
    isLoading: settingsQ.isLoading || campaignsQ.isLoading,
    error: (settingsQ.error ?? campaignsQ.error) as Error | null,
    hasApiKey: settingsQ.data?.hasApiKey ?? true,
  };
}
