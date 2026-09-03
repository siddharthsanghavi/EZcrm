import { redirect } from 'next/navigation';

/**
 * Members moved under Settings, where the rest of the club-wide configuration
 * lives. Kept as a redirect because the old path is in people's bookmarks and
 * in every link the app has ever rendered.
 */
export default function MembersPage() {
  redirect('/settings?tab=members');
}
