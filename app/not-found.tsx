import { Button } from "@/components/base/buttons/button";
import { ErrorState } from "@/components/ui/error-state";

/** 404 for any URL without a page (PH0-16). */
export default function NotFound() {
  return (
    <ErrorState
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved. Modules that haven't shipped yet live in later phases of the build plan."
      backHref="/"
      backLabel="Go to storefront"
    >
      <Button color="primary" size="lg" href="/dashboard">
        Go to dashboard
      </Button>
    </ErrorState>
  );
}
