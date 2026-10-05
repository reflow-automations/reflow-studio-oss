import { Skeleton } from "@/components/ui/skeleton";

/** Route-level fallback while a studio page streams in: a page header and a media grid. */
export default function StudioLoading() {
  return (
    <div role="status" className="flex flex-1 flex-col">
      <div className="flex items-end justify-between gap-3 border-b border-border px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3.5 w-64 max-w-[60vw]" />
        </div>
        <Skeleton className="hidden h-9 w-28 sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:p-6 md:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className={i % 3 === 1 ? "aspect-[4/5] w-full rounded-md" : "aspect-square w-full rounded-md"} />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
