/** Deterministic local filename for an icon path. Shared by the icon-download
 * script and the app so URLs match without a stored mapping. */
export function localIconName(iconPath: string): string {
  return iconPath.replace(/^https?:\/\//, "").replace(/[^\w.-]/g, "_");
}
