import type { Root, RootContent, PhrasingContent } from "mdast";
import { normalizeExternalUrl } from "./externalUrl";

/** Resolve only explicit citation markers against this assistant message's sources. */
export function remarkCitations(sources?: readonly { title: string; url: string }[]) {
  return (tree: Root) => {
    if (!sources?.length) return;
    function walk(parent: Root | RootContent) {
      if (!("children" in parent) || ["link", "linkReference", "code", "inlineCode"].includes(parent.type)) return;
      const children: RootContent[] = [];
      for (const child of parent.children) {
        if (child.type !== "text") {
          walk(child);
          children.push(child);
          continue;
        }
        let offset = 0;
        for (const match of child.value.matchAll(/\[\[cite:([1-9]\d*)\]\]/g)) {
          const source = sources?.[Number(match[1]) - 1];
          const url = source && normalizeExternalUrl(source.url);
          if (!url || !["http:", "https:"].includes(url.protocol)) continue;
          if (match.index > offset) children.push({ type: "text", value: child.value.slice(offset, match.index) });
          children.push({
            type: "link",
            url: url.href,
            title: `${source!.title}\n${url.hostname}`,
            data: { hProperties: { className: "citation-tag" } },
            children: [{ type: "text", value: source!.title || url.hostname.replace(/^www\./, "") }],
          });
          offset = match.index + match[0].length;
        }
        if (offset < child.value.length) children.push({ type: "text", value: child.value.slice(offset) });
      }
      parent.children = children as PhrasingContent[] & RootContent[];
    }
    walk(tree);
  };
}
