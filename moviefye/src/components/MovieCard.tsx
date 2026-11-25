const posterUrl = (path: string | null) =>
  path ? `https://image.tmdb.org/t/p/w92${path}` : null;

function Poster({ path, className }: { path: string | null; className: string }) {
  const url = posterUrl(path);
  if (!url) return <span className={`${className} bg-border`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`${className} object-cover`} />;
}

export function MovieCardRow({
  title,
  year,
  mediaType,
  posterPath,
  rating,
}: {
  title: string;
  year?: string | null;
  mediaType: string;
  posterPath: string | null;
  rating?: number | null;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <Poster path={posterPath} className="h-12 w-8 flex-shrink-0 rounded" />
      <div className="flex flex-1 items-center justify-between gap-2 text-sm">
        <div>
          <div className="font-medium">
            {title}
            {year ? ` (${year})` : ""}
          </div>
          <div className="text-xs text-muted">{mediaType}</div>
        </div>
        {rating ? (
          <span className="whitespace-nowrap text-xs font-medium text-gamify">{rating}/10</span>
        ) : null}
      </div>
    </div>
  );
}

export function MovieCardGrid({
  title,
  posterPath,
}: {
  title: string;
  posterPath: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Poster path={posterPath} className="aspect-[2/3] w-full rounded-lg" />
      <span className="truncate text-xs text-muted">{title}</span>
    </div>
  );
}
