// Next.js can commit HTTP 200 before a streamed notFound() resolves. Require
// its explicit denial boundary and reject any operator content in either case.
export function operatorPageDenied(status, html) {
  return [200, 404].includes(status)
    && html.includes("Page not found")
    && !["Aggregate infrastructure data", "Admitted users", "Connected activation", "Operational data is unavailable"].some(text => html.includes(text));
}
