import React, { useEffect, useMemo, useState } from 'react'
import { panggil, failKeBase64, ambilSesi, AKSES } from '../lib/api'
import { rm, BULAN, KAEDAH_BAYARAN, hariIni, muatTurunCSV } from '../lib/utils'
import { Spinner, useToast, KadStat, Modal, Medan, Pilihan } from '../components/ui'

const TAHUN_INI = new Date().getFullYear()

export default function RekodYuran() {
  const toast = useToast()
  const { role } = ambilSesi()
  const bolehRekod = AKSES.kewangan.includes(role)   // Penuh / Kewangan sahaja

  const [tahun, setTahun] = useState(TAHUN_INI)
  const [rekod, setRekod] = useState(null)
  const [ahli, setAhli] = useState([])
  const [kadar, setKadar] = useState([])
  const [cari, setCari] = useState('')
  const [sedang, setSedang] = useState(false)

  // pilihan bulan untuk key-in (satu ahli pada satu masa)
  const [pilih, setPilih] = useState(null)   // { ic, nama, bulan: [] }
  const [borang, setBorang] = useState(null)
  const [fail, setFail] = useState(null)
  const [lihat, setLihat] = useState(null)   // butiran sel yang sudah bayar

  const muat = () => {
    setRekod(null); setPilih(null)
    Promise.all([
      panggil('senarai', { tab: 'RekodYuran' }),
      panggil('senarai', { tab: 'Staf' }),
      panggil('senarai', { tab: 'KadarYuran' })
    ]).then(([y, a, k]) => {
      if (y.ok) setRekod(y.data); else toast(y.mesej, 'ralat')
      if (a.ok) setAhli(a.data.filter((x) => x.StatusAhli !== 'Tidak Aktif'))
      else toast(a.mesej, 'ralat')
      if (k.ok) setKadar(k.data)
    }).catch((e) => toast(e.message, 'ralat'))
  }
  useEffect(muat, [])

  const bersih = (ic) => String(ic || '').replace(/\D/g, '')

  const kadarUntuk = (kategori) => {
    const k = kadar.find((x) =>
      String(x.Kategori).toLowerCase() === String(kategori || '').toLowerCase() &&
      String(x.Aktif).toUpperCase() === 'YA')
    return k ? { kadar: Number(k.Kadar) || 0, mod: k.Mod || 'Bulanan' } : { kadar: 0, mod: 'Bulanan' }
  }

  const matriks = useMemo(() => {
    if (!rekod) return []
    const peta = {}
    rekod.filter((r) => Number(r.Tahun) === Number(tahun)).forEach((r) => {
      const k = bersih(r.NoKP)
      peta[k] = peta[k] || {}
      peta[k][Number(r.Bulan)] = r
    })
    return ahli
      .filter((a) => !cari || [a.Nama, a.NoKP, a.NoAhli].some((v) => String(v || '').toLowerCase().includes(cari.toLowerCase())))
      .map((a) => {
        const baris = peta[bersih(a.NoKP)] || {}
        const tahunan = Object.prototype.hasOwnProperty.call(baris, 0)
        const bulan = []
        let bayar = 0, tunggak = 0
        const kira = (r) => {
          const status = r ? r.Status : 'Belum Bayar'
          const amaun = r ? Number(r.Amaun || 0) : 0
          if (status === 'Sudah Bayar') bayar += amaun
          if (status === 'Belum Bayar') tunggak += amaun
          return { status, amaun, rujukan: r ? r.RujukanMasukID : '' }
        }
        if (tahunan) {
          const { status, amaun, rujukan } = kira(baris[0])
          for (let b = 1; b <= 12; b++) bulan.push({ b, status, amaun, rujukan, tahunan: true })
        } else {
          for (let b = 1; b <= 12; b++) {
            const { status, amaun, rujukan } = kira(baris[b])
            bulan.push({ b, status, amaun, rujukan })
          }
        }
        return { ahli: a, bulan, bayar, tunggak, tahunan }
      })
  }, [rekod, ahli, tahun, cari, kadar])

  const jana = async () => {
    if (!confirm(`Jana rekod yuran "Belum Bayar" untuk semua ahli aktif bagi tahun ${tahun}?`)) return
    setSedang(true)
    try {
      const r = await panggil('janaYuranTahunan', { tahun })
      r.ok ? (toast(r.mesej, 'ok'), muat()) : toast(r.mesej, 'ralat')
    } catch (e) { toast(e.message, 'ralat') }
    setSedang(false)
  }

  /** Klik sel: pilih bulan untuk key-in, atau papar butiran kalau sudah bayar */
  const klikSel = (m, b) => {
    if (b.status === 'Sudah Bayar' || b.status === 'Pending') {
      setLihat({ nama: m.ahli.Nama, bulan: m.tahunan ? 'Yuran Tahunan' : BULAN[b.b - 1],
                 status: b.status, amaun: b.amaun, rujukan: b.rujukan })
      return
    }
    if (!bolehRekod) return

    const ic = bersih(m.ahli.NoKP)
    const nilaiBulan = m.tahunan ? 0 : b.b
    setPilih((s) => {
      if (!s || s.ic !== ic) return { ic, nama: m.ahli.Nama, ahli: m.ahli, tahunan: m.tahunan, bulan: [nilaiBulan] }
      const ada = s.bulan.includes(nilaiBulan)
      const bulan = ada ? s.bulan.filter((x) => x !== nilaiBulan) : [...s.bulan, nilaiBulan].sort((x, y) => x - y)
      return bulan.length ? { ...s, bulan } : null
    })
  }

  const bukaBorang = () => {
    if (!pilih) return
    const info = kadarUntuk(pilih.ahli.Kategori)
    setFail(null)
    setBorang({
      amaun: (info.kadar * pilih.bulan.length).toFixed(2),
      kaedah: 'Tunai',
      tarikh: hariIni(),
      catatan: ''
    })
  }

  const simpan = async (e) => {
    e.preventDefault()
    setSedang(true)
    try {
      const lampiran = fail ? await failKeBase64(fail) : null
      const r = await panggil('rekodBayaranYuran', {
        noKP: pilih.ahli.NoKP, tahun, bulan: pilih.bulan,
        amaun: Number(borang.amaun), kaedah: borang.kaedah,
        tarikh: borang.tarikh, catatan: borang.catatan, fail: lampiran
      })
      if (r.ok) {
        toast(r.mesej, 'ok')
        setBorang(null); setPilih(null); setFail(null); muat()
      } else toast(r.mesej, 'ralat')
    } catch (err) { toast(err.message, 'ralat') }
    setSedang(false)
  }

  if (!rekod) return <Spinner />

  const jumBayar = matriks.reduce((s, m) => s + m.bayar, 0)
  const jumTunggak = matriks.reduce((s, m) => s + m.tunggak, 0)
  const infoPilih = pilih ? kadarUntuk(pilih.ahli.Kategori) : null

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Rekod Yuran Ahli</h1>
          <p className="text-sm text-slate-500">
            {bolehRekod
              ? 'Klik bulan yang belum bayar untuk rekodkan bayaran bagi pihak ahli'
              : 'Status bayaran yuran mengikut bulan'}
          </p>
        </div>
        <div className="flex gap-2">
          <select className="input w-28" value={tahun} onChange={(e) => { setTahun(Number(e.target.value)); setPilih(null) }}>
            {[TAHUN_INI + 1, TAHUN_INI, TAHUN_INI - 1, TAHUN_INI - 2].map((t) => <option key={t}>{t}</option>)}
          </select>
          <button className="btn-ghost btn-sm" onClick={() => muatTurunCSV(
            `rekod-yuran-${tahun}.csv`,
            ['Nama', 'NoKP', 'Tahun', 'Bulan', 'Amaun', 'Status'],
            rekod.filter((r) => Number(r.Tahun) === Number(tahun))
          )}>Muat Turun CSV</button>
          <button className="btn-primary btn-sm" onClick={jana} disabled={sedang}>
            {sedang ? 'Menjana...' : `Jana Yuran ${tahun}`}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KadStat tajuk="Yuran Terkumpul" nilai={rm(jumBayar)} warna="text-emerald-600" />
        <KadStat tajuk="Yuran Tertunggak" nilai={rm(jumTunggak)} warna="text-red-600" />
        <KadStat tajuk="Ahli Dipaparkan" nilai={matriks.length} />
      </div>

      <input className="input max-w-xs" placeholder="Cari ahli / no. keahlian..."
        value={cari} onChange={(e) => setCari(e.target.value)} />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left font-medium">Ahli</th>
                {BULAN.map((b) => <th key={b} className="px-2 py-3 font-medium">{b.substring(0, 3)}</th>)}
                <th className="px-4 py-3 text-right font-medium">Tertunggak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matriks.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-10 text-center text-slate-400">
                  Tiada rekod. Klik "Jana Yuran {tahun}" untuk mula.
                </td></tr>
              ) : matriks.map((m) => {
                const dipilihAhli = pilih && pilih.ic === bersih(m.ahli.NoKP)
                return (
                  <tr key={m.ahli._baris} className={dipilihAhli ? 'bg-brand-50' : 'hover:bg-slate-50'}>
                    <td className={`sticky left-0 px-4 py-2 ${dipilihAhli ? 'bg-brand-50' : 'bg-white'}`}>
                      <p className="whitespace-nowrap font-medium text-slate-800">{m.ahli.Nama}</p>
                      <p className="text-xs text-slate-500">
                        {m.ahli.NoAhli ? m.ahli.NoAhli + ' · ' : ''}
                        {m.tahunan ? 'Yuran Tahunan' : (m.ahli.Kategori || m.ahli.Jabatan)}
                      </p>
                    </td>
                    {m.bulan.map((b) => {
                      const nilaiBulan = m.tahunan ? 0 : b.b
                      const ditanda = dipilihAhli && pilih.bulan.includes(nilaiBulan)
                      const bolehKlik = bolehRekod || b.status !== 'Belum Bayar'
                      return (
                        <td key={b.b} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => klikSel(m, b)}
                            disabled={!bolehKlik}
                            title={`${m.tahunan ? 'Yuran Tahunan' : BULAN[b.b - 1]} · ${b.status}${
                              b.status === 'Belum Bayar' && bolehRekod ? ' — klik untuk rekod bayaran' : ''}`}
                            className={`h-6 w-6 rounded transition-all ${
                              ditanda ? 'bg-brand-700 ring-2 ring-brand-300 ring-offset-1'
                                : b.status === 'Sudah Bayar' ? 'bg-emerald-500'
                                : b.status === 'Pending' ? 'bg-amber-400'
                                : 'bg-slate-200'
                            } ${bolehKlik ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
                          />
                        </td>
                      )
                    })}
                    <td className={`whitespace-nowrap px-4 py-2 text-right font-medium ${
                      m.tunggak > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{rm(m.tunggak)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <span>Ahli mod tahunan dipaparkan sebagai satu status merentasi 12 bulan.</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500" /> Sudah Bayar</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-400" /> Menunggu Pengesahan</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-slate-200" /> Belum Bayar</span>
        {bolehRekod && (
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand-700" /> Dipilih</span>
        )}
      </div>

      {/* Bar tindakan bila ada bulan dipilih */}
      {pilih && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-lg no-print">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800">{pilih.nama}</p>
              <p className="text-xs text-slate-500">
                {pilih.bulan.map((b) => (b === 0 ? 'Yuran Tahunan' : BULAN[b - 1].substring(0, 3))).join(', ')}
                {' · '}{pilih.bulan.length} {pilih.tahunan ? 'bayaran' : 'bulan'}
                {infoPilih?.kadar > 0 && ` · ${rm(infoPilih.kadar * pilih.bulan.length)}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => setPilih(null)}>Batal</button>
              <button className="btn-primary btn-sm" onClick={bukaBorang}>Rekod Bayaran</button>
            </div>
          </div>
        </div>
      )}

      {/* Borang key-in bayaran */}
      <Modal buka={!!borang} tutup={() => setBorang(null)} tajuk="Rekod Bayaran Bagi Pihak Ahli" saiz="max-w-lg">
        {borang && pilih && (
          <form onSubmit={simpan} className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-slate-500">Ahli</span>
                <span className="font-medium">{pilih.nama}</span>
                <span className="text-slate-500">No. Keahlian</span>
                <span>{pilih.ahli.NoAhli || '-'}</span>
                <span className="text-slate-500">Kategori</span>
                <span>{pilih.ahli.Kategori || '-'} ({infoPilih?.mod})</span>
                <span className="text-slate-500">Tempoh</span>
                <span className="font-medium">
                  {pilih.bulan.map((b) => (b === 0 ? 'Yuran Tahunan' : BULAN[b - 1])).join(', ')} {tahun}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Medan label="Amaun (RM)">
                <input type="number" step="0.01" min="0" className="input" value={borang.amaun}
                  onChange={(e) => setBorang({ ...borang, amaun: e.target.value })} required />
              </Medan>
              <Medan label="Tarikh Bayaran">
                <input type="date" className="input" value={borang.tarikh}
                  onChange={(e) => setBorang({ ...borang, tarikh: e.target.value })} required />
              </Medan>
              <Medan label="Kaedah Bayaran">
                <Pilihan nilai={borang.kaedah} kosong={null} senarai={KAEDAH_BAYARAN}
                  tukar={(v) => setBorang({ ...borang, kaedah: v })} />
              </Medan>
              <Medan label="Bukti (pilihan)">
                <input type="file" accept="image/*,application/pdf" className="input"
                  onChange={(e) => setFail(e.target.files[0] || null)} />
              </Medan>
              <Medan label="Catatan (pilihan)" jajar="sm:col-span-2">
                <input className="input" value={borang.catatan} placeholder="Cth: Bayar tunai kepada Bendahari"
                  onChange={(e) => setBorang({ ...borang, catatan: e.target.value })} />
              </Medan>
            </div>

            <p className="rounded-lg bg-brand-50 p-3 text-xs text-brand-900">
              Rekod ini terus bertaraf <b>Confirmed</b> kerana anda sendiri yang menerima bayaran.
              Resit rasmi akan dijana automatik dan diemelkan kepada ahli.
            </p>

            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={sedang}>
                {sedang ? 'Menyimpan...' : 'Simpan & Jana Resit'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setBorang(null)}>Batal</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Butiran sel yang sudah ada rekod */}
      <Modal buka={!!lihat} tutup={() => setLihat(null)} tajuk="Butiran Bayaran" saiz="max-w-sm">
        {lihat && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-slate-500">Ahli</span><span className="font-medium">{lihat.nama}</span>
              <span className="text-slate-500">Tempoh</span><span>{lihat.bulan} {tahun}</span>
              <span className="text-slate-500">Status</span>
              <span className={lihat.status === 'Sudah Bayar' ? 'text-emerald-700' : 'text-amber-700'}>
                {lihat.status}
              </span>
              <span className="text-slate-500">Amaun</span><span>{rm(lihat.amaun)}</span>
              <span className="text-slate-500">Rujukan</span><span>{lihat.rujukan || '-'}</span>
            </div>
            {lihat.status === 'Pending' && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Ahli dah hantar bukti melalui portal. Pergi ke <b>Duit Masuk</b> untuk sahkan.
              </p>
            )}
            <button className="btn-ghost w-full" onClick={() => setLihat(null)}>Tutup</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
