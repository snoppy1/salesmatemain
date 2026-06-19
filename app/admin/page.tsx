import { redirect } from "next/navigation";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { listAllShops } from "@/lib/shopRepo";
import AdminConsole from "./AdminConsole";

export default async function AdminPage() {
  const su = await getCurrentSuperadmin();
  if (!su) redirect("/admin/login");

  const shops = await listAllShops();
  return <AdminConsole username={su.username} shops={shops} />;
}
