import { SearchTrigger } from "@/components/search/SearchTrigger";
import { Page } from "@/components/shell/Page";
import { LinkButton } from "@/components/ui/button";
import { copy } from "@/lib/copy";

/**
 * Rendered whenever a route misses or a page calls `notFound()`. Next serves it
 * with a real 404 status, which matters: this is an indexable content site and
 * soft 404s get crawled as if they were real pages.
 */
export default function NotFound() {
  return (
    <Page>
      <div className="mx-auto max-w-[480px] py-10 text-center">
        <p className="font-display text-[58px] leading-none font-extrabold text-primary">
          {copy.notFound.code}
        </p>
        <h1 className="mt-3 text-[19px] font-semibold">{copy.notFound.title}</h1>
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-subtle-foreground">
          {copy.notFound.body}
        </p>

        <div className="mt-4.5">
          <SearchTrigger size="md" />
        </div>

        <LinkButton href="/" variant="outline" size="lg" block className="mt-2.5">
          {copy.notFound.backHome}
        </LinkButton>
      </div>
    </Page>
  );
}
