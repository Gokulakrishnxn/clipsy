// Next.js only loads middleware from src/ when the app lives in src/.
export { middleware } from "../middleware";

export const config = {
  matcher: "/:path*",
};
