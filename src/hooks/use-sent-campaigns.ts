import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCampaigns, type Campaign } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";

const MAX_PAGES = 20;

// Loads every campaign once and shares it across Dashboard, Fluxos and Análises
// (same query key as the Dashboard), so all screens work on the same data.
export function useCampaignHistory() {
  const fetchSettings = useServerFn(getSettings);
  const fetchCampaigns = useServerFn(listCampaigns);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });

  const campaignsQ = useQuery({
    queryKey: ["campaigns", "all"],
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
    queryFn: async () => {
      let campaigns: Campaign[] = [];
      let total = Infinity;
      for (let page = 0; page < MAX_PAGES && campaigns.length < total; page++) {
        const res = await fetchCampaigns({ data: { offset: campaigns.length } });
        total = res.total;
        if (res.campaigns.length === 0) break;
        campaigns = campaigns.concat(res.campaigns);
      }
      return { campaigns, total };
    },
  });

  return {
    campaigns: campaignsQ.data?.campaigns,
    isLoading: settingsQ.isLoading || campaignsQ.isLoading,
    error: (settingsQ.error ?? campaignsQ.error) as Error | null,
    hasApiKey: settingsQ.data?.hasApiKey ?? true,
  };
}
