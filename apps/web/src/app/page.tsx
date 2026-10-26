import { redirect } from "next/navigation";

// The landing page comes in build step 7; until then the app is the front door.
export default function Home() {
  redirect("/clients");
}
