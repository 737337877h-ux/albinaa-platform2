/** Match complete path segments; prefer the deepest visible destination. */
export function activeNavigationHref(pathname: string, hrefs: string[]): string | undefined {
  const clean = (value: string) => value.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const current = clean(pathname);
  return hrefs.filter(href => current === clean(href) || (clean(href) !== '/' && current.startsWith(clean(href) + '/')))
    .sort((a, b) => clean(b).length - clean(a).length)[0];
}
