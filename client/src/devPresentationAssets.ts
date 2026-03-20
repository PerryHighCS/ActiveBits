export interface DevPresentationAsset {
  publicPath: string
  sourceRelativePath: string
  devOnly: boolean
}

export const devPresentationAssets: DevPresentationAsset[] = [
  {
    publicPath: '/presentations/syncdeck-conversion-lab.html',
    sourceRelativePath: '../activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html',
    devOnly: true,
  },
]

export function getDevPresentationAsset(publicPath: string): DevPresentationAsset | null {
  return devPresentationAssets.find((asset) => asset.publicPath === publicPath) ?? null
}
