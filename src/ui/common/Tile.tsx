import type { ReactNode } from 'react'
import type { ProductType } from '../bill/TypeTabs'

interface Props {
  type: ProductType
  /** A photo, when we have one. Otherwise the tile is text only. */
  image?: string
  /** With `onClick` the whole tile is one button (and `label` is its name); without, it is a box that holds buttons. */
  onClick?: () => void
  label?: string
  children: ReactNode
}

/** A flat bone product tile. The type class only colours the small dot inside it. */
export default function Tile({ type, image, onClick, label, children }: Props) {
  const body = (
    <>
      {image && <img className="tile-image" src={image} alt="" loading="lazy" />}
      {children}
    </>
  )
  const className = `tile type-${type}`
  return onClick ? (
    <button type="button" className={className} aria-label={label} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}
