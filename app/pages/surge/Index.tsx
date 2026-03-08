import React, { Suspense } from 'react'
import WebSocketProvider from '../../components/surge/WebSocketProvider'
import TapGrid from '../../components/surge/grid/TapGrid'

export default function SurgePage() {
  return (
    <div className="oui-h-full oui-w-full oui-overflow-hidden">
      <WebSocketProvider>
        <Suspense fallback={<div className="oui-flex oui-h-full oui-items-center oui-justify-center oui-text-base-contrast-54">Loading Surge...</div>}>
          <TapGrid />
        </Suspense>
      </WebSocketProvider>
    </div>
  )
}
