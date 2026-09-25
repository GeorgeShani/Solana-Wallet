import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Activity from './pages/Activity'
import Claim from './pages/Claim'
import Dashboard from './pages/Dashboard'
import Links from './pages/Links'
import Locks from './pages/Locks'
import MintNft from './pages/MintNft'
import More from './pages/More'
import NftDetail from './pages/NftDetail'
import Nfts from './pages/Nfts'
import Onboarding from './pages/Onboarding'
import Receive from './pages/Receive'
import Send from './pages/Send'
import Swap from './pages/Swap'
import Settings from './pages/Settings'
import Stealth from './pages/Stealth'
import Unlock from './pages/Unlock'
import { ToastProvider } from './ui/Toast'
import { useWallet, WalletProvider } from './wallet/WalletContext'

const queryClient = new QueryClient({
  defaultOptions: {
    // the public devnet RPC answers "429 too many requests" in bursts: back off and try again a few times
    queries: { staleTime: 5_000, retry: 3, retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000), refetchOnWindowFocus: false },
  },
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
        <Route path="receive" element={<Receive />} />
        <Route path="swap" element={<Swap />} />
        <Route path="nfts" element={<Nfts />} />
        <Route path="nfts/mint" element={<MintNft />} />
        <Route path="nfts/:address" element={<NftDetail />} />
        <Route path="activity" element={<Activity />} />
        <Route path="more" element={<More />} />
        <Route path="links" element={<Links />} />
        <Route path="locks" element={<Locks />} />
        <Route path="stealth" element={<Stealth />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WalletProvider>
          <BrowserRouter>
            <Routes>
              {/* public: works without a wallet, straight from a claim link */}
              <Route path="/claim" element={<Claim />} />
              <Route path="/*" element={<Gate />} />
            </Routes>
          </BrowserRouter>
        </WalletProvider>
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
