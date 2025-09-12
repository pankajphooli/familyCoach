import { redirect } from 'next/navigation';

export default function Page() {
  // Any old links to /profile/details will land here and get sent to /profile
  redirect('/profile');
}
