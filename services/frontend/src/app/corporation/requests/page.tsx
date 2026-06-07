// QA-R4 R9 — /corporation/requests was the standalone browse page
// (introduced in R8). The R9 design merges its content into
// /corporation/deals so the corp has one unified "דרישה לעובדים
// בזמינות מיידית" surface. This route stays as a redirect so any
// bookmark or dashboard tile still in flight during deploy lands
// on the right page instead of a 404.
import { redirect } from 'next/navigation';
export default function CorporationRequestsRedirect() {
  redirect('/corporation/deals');
}
