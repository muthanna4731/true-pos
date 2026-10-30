import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/bill.css'
import './styles/manager.css'
import './styles/office.css'
import './styles/print.css'
import App from './App'
import { restoreLang } from './i18n'
import { setLoyaltyClient } from './loyalty/client'
import { DemoLoyaltyClient } from './loyalty/demoClient'

restoreLang()
setLoyaltyClient(new DemoLoyaltyClient())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
