import { AppLoading } from "@/components/app-shell";

/**
 * The width the session screen actually uses.
 *
 * This shipped `narrow` to match a `narrow` page, and was left behind when the
 * page went `wide` for its tutor rail — so the placeholder was a 624px column
 * that jumped to 1024px the moment the real screen arrived, which is the exact
 * layout shift a skeleton exists to prevent, run in reverse.
 *
 * The heading is the skill being worked on, which is what we are fetching.
 */
export default function Loading() {
  return <AppLoading bands={2} />;
}
