import { redirect } from "next/navigation";

/** Users are managed on the Settings page (design: sidebar "Settings"). */
export default function UsersPage() {
  redirect("/settings#users");
}
