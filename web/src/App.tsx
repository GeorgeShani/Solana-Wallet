import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Activity from './pages/Activity'
import Claim from './pages/Claim'
import Dashboard from './pages/Dashboard'
import Links from './pages/Links'
import Onboarding from './pages/Onboarding'
import Receive from './pages/Receive'
import Send from './pages/Send'
import Swap from './pages/Swap'
import Settings from './pages/Settings'
import Unlock from './pages/Unlock'
import { useWallet, WalletProvider } from './wallet/WalletContext'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
})

function Gate() {
  const { status } = useWallet()
  if (status === 'loading') return null
  if (status === 'empty') return <Onboarding />
  if (status === 'locked') return <Unlock />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="send" element={<Send />} />
        <Route path="swap" element={<Swap />} />
        <Route path="links" element={<Links />} />
        <Route path="receive" element={<Receive />} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <BrowserRouter>
          <Routes>
            {/* public: works without a wallet, straight from a claim link */}
            <Route path="/claim" element={<Claim />} />
            <Route path="/*" element={<Gate />} />
          </Routes>
        </BrowserRouter>
      </WalletProvider>
    </QueryClientProvider>
  )
}
