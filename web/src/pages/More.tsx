import { ChevronRight, EyeOff, Link2, Settings, Timer } from 'lucide-react'
import { Link } from 'react-router-dom'

const ITEMS = [
  {
    to: '/links',
    icon: Link2,
    title: 'Pay by link',
    text: 'Send money to anyone with a link. They don’t need a wallet or any SOL to receive it.',
  },
  {
    to: '/locks',
    icon: Timer,
    title: 'Lock funds',
    text: 'Send money that unlocks on a date, or a little at a time, like a pay schedule.',
  },
  {
    to: '/stealth',
    icon: EyeOff,
    title: 'Private payments',
    text: 'Get paid at one-time addresses that nobody can link back to you.',
  },
  {
    to: '/settings',
    icon: Settings,
    title: 'Settings',
    text: 'Recovery phrase, network, and removing this wallet from the device.',
  },
]

export default function More() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">More</h1>
      <ul className="divide-y divide-line border-y border-line">
        {ITEMS.map(({ to, icon: Icon, title, text }) => (
          <li key={to}>
            <Link to={to} className="group flex items-center gap-4 py-4 no-underline hover:bg-plate/4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full border border-plate/60 text-plate">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{text}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-plate" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
