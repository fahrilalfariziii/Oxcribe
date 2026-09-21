import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("Seeding database (data mengikuti frontend/src/mock/data.ts)...");
  // TRUNCATE + RESTART IDENTITY agar ID kembali 1..N setiap seed.
  // deleteMany() saja tidak mereset sequence Postgres -> ID drift (8..14, dst)
  // sehingga FE yang pegang ID lama kena 404 "Produk tidak ditemukan".
  await prisma.$executeRawUnsafe(
    `TRUNCATE "order_status_logs","stock_movements","payments","order_items","orders","product_options","products","categories","tables","ingredients","users","platform_audit_logs","invoices","subscriptions","leads","landing_page_sections","platform_admins","plans","businesses" RESTART IDENTITY CASCADE`
  );

  // ---- Business ----
  // Pajak & Biaya default OFF (flag serviceCharge/taxFees=false semua paket):
  // total murni = subtotal, tanpa tambahan pajak/service.
  const business = await prisma.business.create({
    data: {
      name: "Bean & Brew",
      tagline: "Eksplorasi Rasa dalam Setiap Cangkir",
      address: "Jl. Senopati No. 12, Jakarta Selatan",
      phone: "021-555-0192",
      email: "hello@beanbrew.id",
      taxEnabled: false,
      taxLabel: "PB1",
      taxRate: 0, // persen
      taxBearer: "customer",
      serviceChargeEnabled: false,
      serviceChargeRate: 0, // persen
      soundEnabled: true,
      openingCash: 0,
      enabledPaymentMethods: ["cash", "qris", "bank_transfer"],
      paymentSettings: {
        cash: { gateway: "manual" },
        qris: { gateway: "midtrans" },
        bank_transfer: { gateway: "midtrans", bank: "bca", allowedBanks: ["bca", "mandiri", "bni", "bri"] },
      },
      midtransMode: "global",
      midtransQrisAcquirer: null,
    },
  });

  // ---- Staff ----
  const [owner, kasir, barista] = await Promise.all([
    prisma.user.create({
      data: {
        businessId: business.id,
        name: "Amira Owner",
        email: "owner@beanbrew.id",
        role: "owner",
        passwordHash: await hash("Owner123!"),
      },
    }),
    prisma.user.create({
      data: {
        businessId: business.id,
        name: "Raka Kasir",
        email: "kasir@beanbrew.id",
        role: "kasir",
        passwordHash: await hash("Kasir123!"),
      },
    }),
    prisma.user.create({
      data: {
        businessId: business.id,
        name: "Sinta Barista",
        email: "barista@beanbrew.id",
        role: "barista",
        passwordHash: await hash("Barista123!"),
      },
    }),
  ]);

  // ---- Categories ----
  const [catSignature, catEspresso, catNonCoffee, catPastry] = await Promise.all([
    prisma.category.create({ data: { businessId: business.id, name: "Signature", sortOrder: 1 } }),
    prisma.category.create({ data: { businessId: business.id, name: "Espresso", sortOrder: 2 } }),
    prisma.category.create({ data: { businessId: business.id, name: "Non-Coffee", sortOrder: 3 } }),
    prisma.category.create({ data: { businessId: business.id, name: "Pastry", sortOrder: 4 } }),
  ]);

  // ---- Product options template (varian minuman) ----
  const drinkOptionDefs = [
    { name: "Hot", type: "temperature", price: 0, isRequired: true },
    { name: "Iced", type: "temperature", price: 0, isRequired: true },
    { name: "Normal", type: "sugar", price: 0, isRequired: true },
    { name: "Less Sugar", type: "sugar", price: 0, isRequired: true },
    { name: "No Sugar", type: "sugar", price: 0, isRequired: true },
    { name: "Normal", type: "ice", price: 0, isRequired: true },
    { name: "Less Ice", type: "ice", price: 0, isRequired: true },
    { name: "No Ice", type: "ice", price: 0, isRequired: true },
    { name: "Regular", type: "milk", price: 0, isRequired: false },
    { name: "Oat", type: "milk", price: 5000, isRequired: false },
    { name: "Soy", type: "milk", price: 3000, isRequired: false },
    { name: "Extra Espresso", type: "addon", price: 5000, isRequired: false },
    { name: "Vanilla Syrup", type: "addon", price: 5000, isRequired: false },
  ];

  async function createProductWithOptions(
    args: {
      categoryId: number;
      name: string;
      description: string;
      price: number;
      isAvailable: boolean;
      badge?: string;
    },
    optionFilter?: (o: (typeof drinkOptionDefs)[number]) => boolean
  ) {
    const product = await prisma.product.create({
      data: {
        businessId: business.id,
        categoryId: args.categoryId,
        name: args.name,
        description: args.description,
        price: args.price,
        isAvailable: args.isAvailable,
        badge: args.badge,
      },
    });

    const options = optionFilter ? drinkOptionDefs.filter(optionFilter) : drinkOptionDefs;
    if (options.length) {
      await prisma.productOption.createMany({
        data: options.map((o) => ({ productId: product.id, ...o })),
      });
    }
    return product;
  }

  const caramelMacchiato = await createProductWithOptions({
    categoryId: catSignature.id,
    name: "Caramel Macchiato",
    description: "Espresso dengan sirup vanilla, susu segar, dan karamel.",
    price: 45000,
    isAvailable: true,
    badge: "SIGNATURE",
  });

  const doubleEspresso = await createProductWithOptions(
    {
      categoryId: catEspresso.id,
      name: "Double Espresso",
      description: "Dua shot espresso murni dari biji kopi house blend.",
      price: 30000,
      isAvailable: true,
    },
    (o) => o.type === "temperature" || o.type === "addon"
  );

  await createProductWithOptions({
    categoryId: catPastry.id,
    name: "Butter Croissant",
    description: "Croissant klasik ala Perancis yang renyah di luar.",
    price: 25000,
    isAvailable: false,
  }, () => false);

  const matchaLatte = await createProductWithOptions({
    categoryId: catNonCoffee.id,
    name: "Matcha Latte",
    description: "Bubuk matcha premium Jepang yang diseduh dengan sempurna.",
    price: 40000,
    isAvailable: true,
  });

  await createProductWithOptions({
    categoryId: catSignature.id,
    name: "Iced Caramel Latte",
    description: "Espresso dengan sirup karamel dan susu oat segar.",
    price: 45000,
    isAvailable: true,
    badge: "SIGNATURE",
  });

  await createProductWithOptions({
    categoryId: catEspresso.id,
    name: "Flat White",
    description: "Double ristretto dengan microfoam susu yang lembut.",
    price: 38000,
    isAvailable: true,
  });

  await createProductWithOptions({
    categoryId: catPastry.id,
    name: "Almond Croissant",
    description: "Croissant isi krim almond dengan taburan kacang.",
    price: 32000,
    isAvailable: true,
  }, () => false);

  // ---- Tables ----
  const tableDefs = [
    { tableNumber: "01", qrToken: "table-01", isActive: true },
    { tableNumber: "02", qrToken: "table-02", isActive: true },
    { tableNumber: "03", qrToken: "table-03", isActive: true },
    { tableNumber: "04", qrToken: "table-04", isActive: true },
    { tableNumber: "05", qrToken: "table-05", isActive: true },
    { tableNumber: "06", qrToken: "table-06", isActive: false },
  ];
  const tables = await Promise.all(
    tableDefs.map((t) => prisma.cafeTable.create({ data: { businessId: business.id, ...t } }))
  );

  // ---- Ingredients + 1 contoh stock movement ----
  const espressoBeans = await prisma.ingredient.create({
    data: {
      businessId: business.id,
      name: "Espresso Beans (House)",
      unit: "kg",
      currentStock: 12.4,
      minimumStock: 4,
      isAvailable: true,
    },
  });
  await prisma.stockMovement.create({
    data: {
      businessId: business.id,
      ingredientId: espressoBeans.id,
      type: "in",
      quantity: 5,
      stockBefore: 7.4,
      stockAfter: 12.4,
      notes: "Restock mingguan",
      userId: barista.id,
    },
  });

  await prisma.ingredient.create({
    data: { businessId: business.id, name: "Oat Milk", unit: "L", currentStock: 3.2, minimumStock: 5, isAvailable: true },
  });
  await prisma.ingredient.create({
    data: { businessId: business.id, name: "Vanilla Syrup", unit: "botol", currentStock: 6, minimumStock: 2, isAvailable: true },
  });
  await prisma.ingredient.create({
    data: { businessId: business.id, name: "Croissants", unit: "pcs", currentStock: 0, minimumStock: 8, isAvailable: false },
  });
  await prisma.ingredient.create({
    data: { businessId: business.id, name: "Susu Fresh", unit: "L", currentStock: 18, minimumStock: 8, isAvailable: true },
  });

  // ---- 2 contoh order (biar endpoint /orders & /analytics langsung ada datanya) ----
  // Pajak & Biaya OFF: serviceCharge=0, tax=0, total=subtotal murni.
  const order1 = await prisma.order.create({
    data: {
      businessId: business.id,
      orderNumber: "BB-9021",
      clientOrderId: "seed-cli-o-1",
      tableId: tables[3].id, // meja 04
      customerName: "Dina",
      source: "self_order",
      status: "diproses",
      paymentMethod: "qris",
      paymentStatus: "paid",
      subtotal: 90000,
      serviceCharge: 0,
      tax: 0,
      taxLabel: "PB1",
      taxBearer: "customer",
      total: 90000,
      items: {
        createMany: {
          data: [
            {
              productId: caramelMacchiato.id,
              productName: "Caramel Macchiato",
              price: 45000,
              quantity: 1,
              options: { temperature: "Iced", sugar: "Less Sugar" },
              optionsLabel: "Iced, Less Sugar",
              subtotal: 45000,
            },
            {
              productId: matchaLatte.id,
              productName: "Matcha Latte",
              price: 45000,
              quantity: 1,
              options: { milk: "Oat" },
              optionsLabel: "Oat Milk",
              subtotal: 45000,
            },
          ],
        },
      },
      statusLogs: { createMany: { data: [{ status: "diterima" }, { status: "diproses" }] } },
      payments: {
        create: { businessId: business.id, method: "qris", status: "paid", amount: 90000, paidAt: new Date() },
      },
    },
  });

  const order2 = await prisma.order.create({
    data: {
      businessId: business.id,
      orderNumber: "BB-9022",
      clientOrderId: "seed-cli-o-2",
      tableId: tables[1].id, // meja 02
      customerName: "Andi",
      source: "self_order",
      status: "diterima",
      paymentMethod: "cash",
      paymentStatus: "pending",
      subtotal: 30000,
      serviceCharge: 0,
      tax: 0,
      taxLabel: "PB1",
      taxBearer: "customer",
      total: 30000,
      items: {
        create: {
          productId: doubleEspresso.id,
          productName: "Double Espresso",
          price: 30000,
          quantity: 1,
          options: { temperature: "Hot" },
          optionsLabel: "Hot",
          subtotal: 30000,
        },
      },
      statusLogs: { create: { status: "diterima" } },
      payments: { create: { businessId: business.id, method: "cash", status: "pending", amount: 30000 } },
    },
  });

  console.log("Seed selesai ✅");
  console.log("----------------------------------------------------");
  console.log("Login staff (POST /api/auth/login):");
  console.log(`  Owner    -> ${owner.email} / Owner123!`);
  console.log(`  Kasir    -> ${kasir.email} / Kasir123!`);
  console.log(`  Barista  -> ${barista.email} / Barista123!`);
  console.log("----------------------------------------------------");
  console.log(`Business ID   : ${business.id}`);
  console.log(`QR token meja : ${tableDefs.map((t) => t.qrToken).join(", ")}`);
  console.log(`Contoh order  : ${order1.orderNumber}, ${order2.orderNumber}`);
  console.log("----------------------------------------------------");

  // ================= Layer platform SaaS (Fase 3) =================
  // Paket dari sumber tunggal backend/src/lib/plans.ts agar konsisten dengan
  // fallback statis GET /api/public/plans.
  const { PLANS } = await import("../src/lib/plans");
  const seededPlans = await Promise.all(
    PLANS.map((p) =>
      prisma.plan.create({
        data: {
          code: p.code,
          name: p.name,
          price: p.price,
          billingCycle: p.billingCycle,
          featureFlags: p.featureFlags as object,
          limits: p.limits as object,
        },
      })
    )
  );
  const proPlan = seededPlans.find((p) => p.code === "pro")!;

  // Bean & Brew jadi tenant aktif paket Pro sejak seed.
  await prisma.business.update({
    where: { id: business.id },
    data: { slug: "bean-brew", currentPlanId: proPlan.id, onboardedAt: new Date(), status: "active" },
  });
  await prisma.subscription.create({
    data: { businessId: business.id, planId: proPlan.id, status: "active", currentPeriodStart: new Date() },
  });

  // Akun platform admin (POST /api/platform/auth/login) — terpisah dari staff tenant.
  await prisma.platformAdmin.createMany({
    data: [
      { name: "Super Admin", email: "admin@ordria.id", passwordHash: await hash("Admin123!"), role: "superadmin" },
      { name: "Support", email: "support@ordria.id", passwordHash: await hash("Support123!"), role: "support" },
    ],
  });

  // Konten default landing (CMS) — copy awal, bisa diubah dari Platform Admin.
  await prisma.landingSection.createMany({
    data: [
      {
        sectionKey: "hero",
        content: {
          badge: "Platform SaaS POS & Self-Order Multi-Tenant",
          title: "Sistem Kasir & Pemesanan Terpadu untuk Coffee Shop Modern.",
          subtitle:
            "Self-order QR meja tanpa unduh aplikasi, feed order real-time untuk kasir/barista, manajemen stok, dan analitik owner — semua dalam satu aplikasi.",
        },
        sortOrder: 1,
      },
      {
        sectionKey: "features",
        content: {
          heading: "Nilai Unggulan Ordria untuk Operasional Kafe",
          items: [
            { icon: "qr_code_2", title: "Zero App Download", desc: "Pelanggan scan QR di meja dan langsung memesan dari browser HP — tanpa install aplikasi apa pun.", tag: "Fast Checkout" },
            { icon: "bolt", title: "Feed Order Real-time", desc: "Pesanan self-order masuk ke layar kasir/barista seketika, lengkap dengan notifikasi suara dan update status live ke pelanggan.", tag: "Auto Sync Data" },
            { icon: "inventory_2", title: "Manajemen Bahan & Stok", desc: "Catat penerimaan dan penyesuaian stok dengan alasan wajib — seluruh pergerakan tersimpan sebagai riwayat.", tag: "Stock Opname" },
            { icon: "monitoring", title: "Analitik Owner", desc: "Pantau omset, Self Order vs Manual, dan performa item per menu/kategori/varian — bisa diekspor ke CSV.", tag: "Owner Analytics" },
          ],
        },
        sortOrder: 2,
      },
      {
        sectionKey: "faq",
        content: {
          heading: "Pertanyaan yang Sering Diajukan",
          subtitle: "Semua yang perlu Anda ketahui mengenai implementasi Ordria di kafe Anda.",
          items: [
            { q: "Apakah pelanggan harus download aplikasi untuk Self-Ordering?", a: "Tidak. Pelanggan cukup mengarahkan kamera HP ke QR di meja — halaman menu langsung terbuka di browser dan bisa memilih varian hingga membayar via QRIS atau tunai di kasir." },
            { q: "Bagaimana jika koneksi internet di kafe tiba-tiba terputus?", a: "Frontoffice tetap bisa mencatat transaksi tunai dan pergerakan stok sebagai data pending, lalu tersinkron otomatis saat koneksi kembali. Pembayaran non-tunai membutuhkan koneksi untuk verifikasi." },
            { q: "Apa saja yang bisa dikelola owner dari BackOffice?", a: "Katalog menu beserta varian dan add-ons, kategori, meja beserta QR-nya, akun staff, pengaturan pajak & service charge, metode pembayaran, tema self-order, serta laporan omset dan performa item." },
            { q: "Apakah saya bisa upgrade atau downgrade paket sewaktu-waktu?", a: "Bisa. Hubungi tim sales — perubahan paket langsung memengaruhi akses fitur, sedangkan seluruh data historis tetap tersimpan." },
          ],
        },
        sortOrder: 3,
      },
      {
        sectionKey: "cta",
        content: {
          badge: "Onboarding Terpandu",
          title: "Siap Tingkatkan Efisiensi & Omset Kafe Anda Hari Ini?",
          subtitle:
            "Diskusikan kebutuhan kafe Anda bersama tim sales Ordria — dari pilihan paket, jadwal live demo, hingga rencana implementasi di outlet Anda.",
          note: "✓ Setup dibantu tim spesialis • Data isolasi aman tingkat multi-tenant • Support responsif",
        },
        sortOrder: 4,
      },
      {
        sectionKey: "contact",
        content: { whatsapp: "6281234567890", hours: "Online Senin – Minggu (08.00 – 21.00 WIB)" },
        sortOrder: 5,
      },
      {
        sectionKey: "services",
        content: {
          badge: "Jasa Website Ordria",
          heading: "Website Profesional untuk Bisnis Anda",
          subtitle:
            "Dari company profile hingga web app custom — dirancang rapi, cepat, dan siap mengembangkan bisnis. Tanpa harga paket, semua via konsultasi gratis.",
          items: [
            { icon: "business", title: "Company Profile", desc: "Website profil perusahaan yang rapi dan meyakinkan di semua perangkat.", tag: "Profil Bisnis" },
            { icon: "ads_click", title: "Landing Page", desc: "Halaman fokus konversi untuk kampanye dan promosi — cepat dimuat.", tag: "Konversi" },
            { icon: "shopping_bag", title: "Katalog & E-Commerce", desc: "Jual produk online dengan katalog mudah dikelola dan pembayaran digital.", tag: "Online Shop" },
            { icon: "code", title: "Custom Web App", desc: "Dashboard, sistem internal, dan integrasi API sesuai kebutuhan spesifik.", tag: "Custom" },
          ],
          steps: [
            { title: "Konsultasi Gratis", desc: "Petakan scope, timeline, dan estimasi biaya secara transparan." },
            { title: "Desain", desc: "Rancangan direview dan direvisi bersama hingga disetujui." },
            { title: "Development", desc: "Dibangun responsif, cepat, dan SEO-ready." },
            { title: "Deploy & Maintenance", desc: "Diluncurkan ke domain Anda, plus opsi maintenance lanjutan." },
          ],
        },
        sortOrder: 6,
      },
      {
        sectionKey: "home",
        content: {
          badge: "SaaS POS Kafe & Jasa Pembuatan Website",
          title: "Dua Solusi Digital untuk Bisnis Anda.",
          subtitle:
            "Ordria menghadirkan sistem kasir self-order untuk coffee shop modern dan jasa pembuatan website profesional — pilih yang sesuai kebutuhan Anda.",
          products: [
            { icon: "point_of_sale", title: "Ordria POS — SaaS Kafe", desc: "Kasir, self-order QR meja, manajemen stok, dan analitik owner dalam satu aplikasi berlangganan.", ctaLabel: "Lihat Paket POS", href: "/pos-kafe" },
            { icon: "language", title: "Jasa Website Ordria", desc: "Company profile, landing page, e-commerce, hingga web app custom — via konsultasi gratis.", ctaLabel: "Jelajahi Jasa Website", href: "/jasa-website" },
          ],
          cta: { title: "Belum yakin pilih yang mana?", subtitle: "Ceritakan kebutuhan Anda — tim kami akan mengarahkan ke solusi yang paling pas." },
          faqs: [
            { q: "Apa itu Ordria?", a: "Ordria menghadirkan dua solusi digital: Ordria POS, aplikasi kasir & self-order berlangganan untuk coffee shop, dan Jasa Website Ordria, layanan pembuatan website profesional untuk berbagai bisnis." },
            { q: "Apa bedanya Ordria POS dan Jasa Website?", a: "Ordria POS adalah produk SaaS siap pakai dengan paket bulanan — daftar, aktivasi, langsung jalan. Jasa Website adalah layanan custom: setiap website dirancang dan dibangun sesuai kebutuhan spesifik bisnis Anda lewat konsultasi gratis." },
            { q: "Bagaimana cara memulai?", a: "Untuk Ordria POS, lihat halaman paket lalu hubungi sales untuk aktivasi. Untuk jasa website, buka halaman Jasa Website Ordria lalu kirim kebutuhan Anda lewat formulir konsultasi — gratis tanpa komitmen." },
            { q: "Bagaimana pembayaran dan dukungannya?", a: "Langganan POS mendukung QRIS, transfer bank, dan tunai dengan invoice bulanan. Jasa website memakai penawaran per proyek. Keduanya didukung tim support yang bisa dihubungi via WhatsApp dan email." },
          ],
        },
        sortOrder: 0,
      },
    ],
  });

  console.log("----------------------------------------------------");
  console.log("Login platform (POST /api/platform/auth/login):");
  console.log("  Superadmin -> admin@ordria.id / Admin123!");
  console.log("  Support    -> support@ordria.id / Support123!");
  console.log("----------------------------------------------------");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
