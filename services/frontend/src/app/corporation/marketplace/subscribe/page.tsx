import { redirect } from 'next/navigation';

// R33 B.4 · this was "רכישת מנוי לשירותים נלווים" for corporations. A
// corporation publishes housing only, and housing is covered by its
// licence (U8, Yulian 14.09), so there was never anything here for it
// to buy. The page is gone; the route stays as a redirect so an old
// bookmark or link lands on the listings instead of a 404. Providers
// buy a plan at /provider/marketplace/subscribe.
export default function CorporationSubscribeRedirect() {
  redirect('/corporation/marketplace');
}
