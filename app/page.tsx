import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth";
import { getShopData } from "@/lib/shopRepo";
import Dashboard from "./Dashboard";

export default async function Page() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");

  const initial = await getShopData(admin.shopId);
  return <Dashboard username={admin.username} initial={initial} />;
}
