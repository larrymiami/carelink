import { redirect } from "next/navigation";
import { session } from "../../lib/server";
import { Shell } from "../../components/shell";
import Login from "../../components/login";
export default async function Page() {
  if (await session("operator")) redirect("/inbox");
  return (
    <Shell>
      <Login />
    </Shell>
  );
}
