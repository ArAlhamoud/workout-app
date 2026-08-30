import { redirect } from 'next/navigation';

// The room was renamed Diet (owner, Aug 29); old links keep working.
export default function FuelRedirect() {
  redirect('/health/diet');
}
