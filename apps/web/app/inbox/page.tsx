import { redirect } from "next/navigation";
import { session } from "../../lib/server";
import { Shell } from "../../components/shell";
import Inbox from "../../components/inbox";
export default async function Page() {
  const current = await session("operator");
  if (!current || current.kind !== "operator") redirect("/login");
  return (
    <Shell>
      <Inbox officer={current.officer} />
    </Shell>
  );
}
