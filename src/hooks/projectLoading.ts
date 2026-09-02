// Project data can refresh often while agents are working. Only the first load
// should replace the workspace with a blocking loading state; later refreshes
// should update the existing UI in place.
export const shouldBlockProjectsFetch = (hasCompletedInitialFetch: boolean) => (
  !hasCompletedInitialFetch
);
