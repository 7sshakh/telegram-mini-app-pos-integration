import { MiniApp } from "@/components/MiniApp";
import { AppProvider } from "@/lib/client/store";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppProvider>
      <MiniApp />
    </AppProvider>
  );
}
