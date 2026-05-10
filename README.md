# CineSoft

---

## English

### Overview
CineSoft is a desktop media hub that combines movie/TV/anime discovery, torrent source search, download management, library tracking, and subtitle download in one interface.

### Features
- Discover movies, TV shows, and anime in one place
- TMDB-powered metadata, posters, and detail pages
- Advanced source search with Prowlarr integration
- Alternative source search with Torrentio support
- Sort sources by seeders, size, and name
- Enable/disable torrent sites from settings
- Choose between embedded torrent engine or qBittorrent
- Select files before starting downloads
- Download queue and status tracking
- Personal library view for downloaded media
- Subtitle download integration (OpenSubtitles v3 endpoint)
  - Movie subtitle download from library cards
  - Episode subtitle download from series/anime episode rows
  - Save subtitle next to video with matching filename
- Multi-language UI (Turkish / English)

### Screenshots

#### Home & Movies
<p align="center">
  <img src="screenshots/home.png" width="49%" />
  <img src="screenshots/movies.png" width="49%" />
</p>

#### Detail Page
<p align="center">
  <img src="screenshots/detail-overview.png" width="49%" />
  <img src="screenshots/detail-media.png" width="49%" />
</p>

#### Settings
<p align="center">
  <img src="screenshots/settings-general.png" width="49%" />
  <img src="screenshots/settings-prowlarr.png" width="49%" />
</p>

### Installation
> `.exe` distribution is no longer provided.  
> Because of recurring Windows SmartScreen/code-signing friction, CineSoft is now installed and run via source + npm only.

```powershell
git clone https://github.com/Margthus/Cinesoft
cd Cinesoft
npm install
npm start
```

### Requirements
- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) 9+
- [Git](https://git-scm.com/)
- Windows
- Python 3.11+ (for local torrent service)
- TMDB API key (required for metadata/posters/details)
- Optional: Prowlarr installation for Prowlarr-based source search

### TMDB API Key (Required)
Get your own API key from TMDB:

https://www.themoviedb.org/settings/api

Then add it from the app Settings page.

### Prowlarr (Optional, User-Installed)
Download Prowlarr from:

https://github.com/Prowlarr/Prowlarr/releases

Users should install/configure Prowlarr on their own machine for Prowlarr-based source search.  
If using local resources flow, place files under:

```text
resources/prowlarr/
```

This folder is intentionally excluded from the repository.

### Build (Developer)
```powershell
npm run build
```

### Roadmap
- Partial streaming infrastructure
- Manga viewing and reading
- Comics viewing and reading

---

## Türkçe

### Genel Bakış
CineSoft; film, dizi ve anime keşfi, torrent kaynak arama, indirme yönetimi, kütüphane takibi ve altyazı indirmeyi tek arayüzde birleştiren masaüstü medya uygulamasıdır.

### Özellikler
- Film, dizi ve anime içeriklerini tek yerde keşfetme
- TMDB tabanlı metadata, afiş ve detay sayfaları
- Prowlarr entegrasyonu ile gelişmiş kaynak arama
- Torrentio desteği ile alternatif kaynak arama
- Kaynakları seeder, boyut ve isme göre sıralama
- Ayarlardan torrent sitelerini açma/kapatma
- Dahili torrent motoru veya qBittorrent seçimi
- İndirme başlamadan önce dosya seçebilme
- İndirme listesi ve durum takibi
- İndirilen içerikler için kişisel kütüphane görünümü
- Altyazı indirme entegrasyonu (OpenSubtitles v3 endpoint)
  - Film kartları üzerinden altyazı indirme
  - Dizi/anime bölüm satırlarından altyazı indirme
  - Altyazıyı video ile aynı klasöre, aynı adla yazma
- Çok dilli arayüz (Türkçe / İngilizce)

### Ekran Görüntüleri

#### Ana Sayfa & Filmler
<p align="center">
  <img src="screenshots/home.png" width="49%" />
  <img src="screenshots/movies.png" width="49%" />
</p>

#### Detay Sayfası
<p align="center">
  <img src="screenshots/detail-overview.png" width="49%" />
  <img src="screenshots/detail-media.png" width="49%" />
</p>

#### Ayarlar
<p align="center">
  <img src="screenshots/settings-general.png" width="49%" />
  <img src="screenshots/settings-prowlarr.png" width="49%" />
</p>

### Kurulum (Installation)
> Artık `.exe` dağıtımı yapılmıyor.  
> Windows SmartScreen ve code-signing kaynaklı sürtünme nedeniyle CineSoft yalnızca kaynak kod + npm ile kurulur ve çalıştırılır.

```powershell
git clone https://github.com/Margthus/Cinesoft
cd Cinesoft
npm install
npm start
```

### Gereksinimler
- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) 9+
- [Git](https://git-scm.com/)
- Windows
- Python 3.11+ (yerel torrent servisi için)
- TMDB API anahtarı (metadata/afiş/detaylar için zorunlu)
- İsteğe bağlı: Prowlarr tabanlı kaynak arama için Prowlarr kurulumu

### TMDB API Anahtarı (Zorunlu)
TMDB API anahtarınızı buradan alın:

https://www.themoviedb.org/settings/api

Sonrasında uygulama içindeki Ayarlar sayfasından ekleyin.

### Prowlarr (İsteğe Bağlı, Kullanıcı Kurar)
Prowlarr indirme sayfası:

https://github.com/Prowlarr/Prowlarr/releases

Prowlarr tabanlı kaynak arama için kullanıcıların Prowlarr'ı kendi sistemlerine kurup yapılandırması gerekir.  
Yerel kaynak akışı kullanılacaksa dosyaları şu klasöre koyun:

```text
resources/prowlarr/
```

Bu klasör bilerek repoya dahil edilmez.

### Build (Geliştirici)
```powershell
npm run build
```

### Gelecek Planları
- Kısmi streaming altyapısı
- Manga görüntüleme ve okuma
- Comics görüntüleme ve okuma

