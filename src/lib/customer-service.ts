export function normalizeWhatsAppNumber(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (value.length > 40 || !/^\+?[\d\s()-]+$/.test(value)) {
    throw new Error('Masukkan nomor WhatsApp yang valid, misalnya 081234567890 atau +6281234567890.')
  }
  let number = value.replace(/[\s()+-]/g, '')
  if (number.startsWith('08')) number = '62' + number.slice(1)
  else if (number.startsWith('8')) number = '62' + number
  if (!/^[1-9]\d{7,14}$/.test(number)) {
    throw new Error('Nomor WhatsApp harus berisi 8–15 digit dengan kode negara, atau diawali 08.')
  }
  return number
}

export function whatsappUrl(number: string): string | null {
  return /^[1-9]\d{7,14}$/.test(number) ? `https://wa.me/${number}` : null
}
