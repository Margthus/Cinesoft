# CineSoft

Modern masaustu medya kesif ve torrent istemcisi.

## Ozellikler

- TMDB tabanli film/dizi/anime kesfi
- Prowlarr ve Torrentio ile kaynak arama
- Torrent indirme, kuyruk ve aktif indirme yonetimi
- Library tarama ve kategorilere gore filtreleme (Hepsi / Film / Dizi / Anime)
- Dizi bolum eslestirme ve sezon-bolum goruntuleme
- OpenSubtitles v3 entegrasyonu ile altyazi arama/indirme
  - Film kartindan altyazi secip indirme
  - Dizi/anime bolumunden altyazi secip indirme
  - Secilen altyaziyi video dosyasiyla ayni klasore, ayni adla kaydetme

## Installation

> Not: Windows tarafinda SmartScreen ve imza (code-signing) sureci nedeniyle artik `.exe` dagitimi yapilmiyor. Kurulum yalnizca kaynak kod + npm uzerinden yapilir.

### Gereksinimler

- Node.js 18+ (onerilen: LTS)
- npm 9+
- Python 3.11+ (torrent servis bileseni icin)

### 1) Repoyu klonla

```bash
git clone https://github.com/<kendi-kullanici-adi>/Cinesoft.git
cd Cinesoft
```

### 2) Bagimliliklari kur

```bash
npm install
```

### 3) Uygulamayi calistir (dev)

```bash
npm start
```

Bu komut Vite arayuzunu ve Electron ana surecini birlikte baslatir.

### 4) Build almak istersen

```bash
npm run build
```

## Altyazi Sistemi (Kisa Bilgi)

- Altyazi kaynagi: OpenSubtitles v3 Stremio addon endpointi
- Sonuclar dil bazli filtrelenebilir (ornegin `Turkish (TUR)`, `English (ENG)`)
- Altyazi indirme islemi secilen icerigin fiziksel video dosyasina gore hedef klasore yazilir
- Uygun adlandirma ile harici player'larda otomatik altyazi eslesmesi hedeflenir

## Notlar

- Streaming akisi ve download akisi ayri tutulur.
- Uygulama ayarlari `userData` altinda saklanir.
- Uretim ortaminda loglar `userData/logs/cinesoft.log` altina yazilir.

