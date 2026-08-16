import { AppLoading } from "@/components/app-shell";

/**
 * The heading names the window, which does not depend on the data — but the
 * facts row under it does, so the title is left to the skeleton.
 *
 * Six bands since `/calendar` merged in: the week, where it went, the month,
 * what is coming, what is ahead, and the courses.
 */
export default function Loading() {
  return <AppLoading bands={6} />;
}
