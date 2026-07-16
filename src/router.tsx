import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error: any) => {
          if (typeof error?.message === "string" && error.message.includes("Unauthorized")) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        onError: (error: any) => {
          if (typeof error?.message === "string" && error.message.includes("Unauthorized")) {
            window.location.href = "/login";
          }
        },
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
