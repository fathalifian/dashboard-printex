import { orderPhotoExtension } from './order-photo'

export function isFileDrop(transfer: Pick<DataTransfer, 'types'>) {
  return Array.from(transfer.types).includes('Files')
}

export function droppedOrderPhoto(transfer: Pick<DataTransfer, 'files'>): File {
  if (transfer.files.length !== 1) throw new Error('Seret satu foto ke satu kartu order.')
  const file = transfer.files[0]
  orderPhotoExtension(file)
  return file
}
