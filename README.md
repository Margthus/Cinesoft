# CineSoft

[Latest Release](https://github.com/Margthus/Cinesoft/releases/latest)

---

## English

### Overview
CineSoft is a desktop media hub that combines movie/TV/anime discovery, torrent source search, download management, and library tracking in one interface.

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
- Poster status tags: Watched / Watch Later / Dropped
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

### For Users (Release .exe)
1. Open [Releases](https://github.com/Margthus/Cinesoft/releases/latest)
2. Download the latest Windows installer (`CineSoft Setup ... .exe`)
3. Run the installer and complete setup

### For Developers (Source)
```powershell
git clone https://github.com/Margthus/Cinesoft
cd Cinesoft
npm install
npm start
```

### Requirements
- [Node.js](https://nodejs.org/) (for development)
- [Git](https://git-scm.com/) (for development)
- Windows
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
CineSoft; film, dizi ve anime keşfi, torrent kaynak arama, indirme yönetimi ve kütüphane takibini tek arayüzde birleştiren masaüstü medya uygulamasıdır.

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
- Poster durum etiketleri: İzledim / Sonra İzleyeceğim / Bıraktım
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

### Kullanıcılar İçin (Release .exe)
1. [Releases](https://github.com/Margthus/Cinesoft/releases/latest) sayfasını açın
2. En güncel Windows kurulum dosyasını indirin (`CineSoft Setup ... .exe`)
3. Kurulumu çalıştırıp adımları tamamlayın

### Geliştiriciler İçin (Kaynak Kod)
```powershell
git clone https://github.com/Margthus/Cinesoft
cd Cinesoft
npm install
npm start
```

### Gereksinimler
- [Node.js](https://nodejs.org/) (geliştirme için)
- [Git](https://git-scm.com/) (geliştirme için)
- Windows
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
