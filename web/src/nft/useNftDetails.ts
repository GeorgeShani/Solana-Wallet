import { useQuery } from '@tanstack/react-query'
import { fetchNftDetails } from './chain'

/** An NFT's details (description, picture link), fetched once and cached. */
export function useNftDetails(uri: string) {
  return useQuery({
    queryKey: ['nft-details', uri],
    queryFn: ({ signal }) => fetchNftDetails(uri, signal),
    staleTime: 10 * 60_000,
    retry: false,
  })
}
