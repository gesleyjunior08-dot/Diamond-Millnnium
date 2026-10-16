// Enviar o documento (PDF) direto pelo WhatsApp — usado por Orçamento, Contrato, Recibo,
// Termo de Entrega e Plano de Cortes. Cada página chama:
//   GSJ.wpp.attach({ doc: "Orçamento", format: "a4", margin: [13, 15],
//                    cliente: function(){...}, telefone: function(){...}, ref: function(){...} })
// O botão "Gerar PDF" continua igual (PDF vetorial pela impressão do navegador).
// Este aqui monta um PDF de verdade (A4/A5, várias páginas) a partir da folha na tela e:
//   - no celular (e navegadores com compartilhamento de arquivo): abre a lista de apps
//     já com o PDF anexado — é só escolher o WhatsApp e o contato;
//   - no computador / sem suporte: baixa o PDF e mostra o botão pra abrir o WhatsApp.
(function () {
  "use strict";

  var HTML2CANVAS = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  var JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  var PX_PER_MM = 96 / 25.4;
  var SCALE = 2.5;                       // nitidez do PDF (≈ 240 dpi)
  var FORMATS = { a4: { w: 210, h: 297 }, a5: { w: 148, h: 210 } };

  var GSJ = (window.GSJ = window.GSJ || {});

  // ---------------- utilidades ----------------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Não consegui carregar a biblioteca de PDF — verifique a internet.")); };
      document.head.appendChild(s);
    });
  }
  var libsPromise = null;
  function ensureLibs() {
    if (window.html2canvas && window.jspdf) return Promise.resolve();
    if (!libsPromise) {
      libsPromise = Promise.all([
        window.html2canvas ? 0 : loadScript(HTML2CANVAS),
        window.jspdf ? 0 : loadScript(JSPDF)
      ]).catch(function (e) { libsPromise = null; throw e; });
    }
    return libsPromise;
  }

  function semAcento(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function nomeArquivo(doc, cliente, ref) {
    var partes = [doc + " GSJ"];
    if (cliente) partes.push(cliente);
    else if (ref) partes.push(ref);
    var n = semAcento(partes.join(" - ")).replace(/[^A-Za-z0-9 _.\-]/g, "").replace(/\s+/g, " ").trim();
    return (n || "Documento GSJ").slice(0, 80) + ".pdf";
  }
  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }
  function telefoneWa(raw) {
    var d = soDigitos(raw);
    if (d.length === 10 || d.length === 11) return "55" + d;
    if ((d.length === 12 || d.length === 13) && d.indexOf("55") === 0) return d;
    return "";
  }
  function primeiroNome(s) { return String(s || "").trim().split(/\s+/)[0] || ""; }

  // ---------------- folha -> páginas ----------------
  // blocos que não devem ser cortados ao meio quando houver outra opção
  var KEEP_SELECTOR = ".sheet-rest, .sheet-clause, .sheet-signature, tr, .corte-fig, svg, img";
  // títulos que devem ficar grudados no bloco logo abaixo deles
  var TITLE_SELECTOR = ".corte-sheet-title, .sheet-label";

  function linhaEmBranco(ctx, y, w) {
    var d = ctx.getImageData(0, y, w, 1).data;
    for (var x = 0; x < w * 4; x += 8) {            // amostra a cada 2 px
      if (d[x] < 244 || d[x + 1] < 244 || d[x + 2] < 244) return false;
    }
    return true;
  }

  function calcularCortes(canvas, blocks, pageInnerH) {
    var H = canvas.height, W = canvas.width, ctx = canvas.getContext("2d", { willReadFrequently: true });
    var cuts = [0], y = 0, guarda = 0;
    while (H - y > pageInnerH + 2 && guarda++ < 40) {
      var limite = y + pageInnerH, corte = limite;
      // 1) um bloco "inteiro" atravessa o limite da página? corta antes dele
      var melhor = null;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i], h = b.bottom - b.top;
        if (b.top < limite - 1 && b.bottom > limite + 1 && b.top > y + pageInnerH * 0.3 && h < pageInnerH * 0.85) {
          if (melhor === null || b.top < melhor) melhor = b.top;
        }
      }
      if (melhor !== null) corte = Math.floor(melhor);
      else {
        // 2) senão, procura uma linha em branco logo acima do limite (entre duas linhas de texto)
        var minY = Math.max(y + 1, Math.floor(limite - pageInnerH * 0.12));
        for (var yy = Math.floor(limite); yy >= minY; yy--) {
          if (linhaEmBranco(ctx, yy, W)) { corte = yy; break; }
        }
      }
      cuts.push(corte);
      y = corte;
    }
    cuts.push(H);
    return cuts;
  }

  function gerarPdf(opts) {
    var fmt = FORMATS[opts.format] || FORMATS.a4;
    var my = opts.margin[0], mx = opts.margin[1];
    var innerWmm = fmt.w - 2 * mx, innerHmm = fmt.h - 2 * my;
    var innerWpx = Math.round(innerWmm * PX_PER_MM);
    var sheet = document.querySelector(opts.sheet || "#sheet");
    if (!sheet) return Promise.reject(new Error("Não achei o documento na tela."));

    return ensureLibs()
      .then(function () { return (document.fonts && document.fonts.ready) ? document.fonts.ready : null; })
      .then(function () {
        // cópia da folha fora da tela, na largura exata do papel (sem depender do tamanho do celular)
        var holder = document.createElement("div");
        holder.setAttribute("aria-hidden", "true");
        holder.style.cssText = "position:fixed;left:-20000px;top:0;width:" + innerWpx + "px;background:#fff;pointer-events:none;";
        var clone = sheet.cloneNode(true);
        clone.removeAttribute("id");
        clone.style.cssText = "box-shadow:none;border:none;border-radius:0;max-width:none;width:100%;padding:0;overflow:visible;background:#fff;margin:0;";
        holder.appendChild(clone);
        document.body.appendChild(holder);

        var base = clone.getBoundingClientRect().top;
        var blocks = Array.prototype.map.call(clone.querySelectorAll(KEEP_SELECTOR), function (el) {
          var r = el.getBoundingClientRect();
          return { top: (r.top - base) * SCALE, bottom: (r.bottom - base) * SCALE };
        });
        Array.prototype.forEach.call(clone.querySelectorAll(TITLE_SELECTOR), function (el) {
          var nx = el.nextElementSibling; if (!nx) return;
          var r = el.getBoundingClientRect(), r2 = nx.getBoundingClientRect();
          blocks.push({ top: (r.top - base) * SCALE, bottom: (r2.bottom - base) * SCALE });
        });
        blocks = blocks.filter(function (b) { return b.bottom - b.top > 4; });

        return window.html2canvas(clone, {
          scale: SCALE, backgroundColor: "#ffffff", useCORS: true, logging: false,
          width: innerWpx, windowWidth: innerWpx
        }).then(function (canvas) {
          holder.remove();
          return { canvas: canvas, blocks: blocks };
        }, function (e) { holder.remove(); throw e; });
      })
      .then(function (r) {
        var canvas = r.canvas;
        var pageInnerH = innerHmm * PX_PER_MM * SCALE;
        var cuts = calcularCortes(canvas, r.blocks, pageInnerH);
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: "mm", format: [fmt.w, fmt.h], orientation: "portrait", compress: true });
        for (var i = 0; i < cuts.length - 1; i++) {
          var y0 = cuts[i], y1 = cuts[i + 1], h = y1 - y0;
          if (h < 4) continue;
          var part = document.createElement("canvas");
          part.width = canvas.width; part.height = h;
          var pc = part.getContext("2d");
          pc.fillStyle = "#fff"; pc.fillRect(0, 0, part.width, part.height);
          pc.drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);
          if (i > 0) pdf.addPage([fmt.w, fmt.h], "portrait");
          pdf.addImage(part.toDataURL("image/jpeg", 0.93), "JPEG", mx, my, innerWmm, h / SCALE / PX_PER_MM, undefined, "FAST");
        }
        try { pdf.setProperties({ title: opts.titulo || "Documento GSJ", author: "GSJ Marcenaria & Móveis Planejados" }); } catch (e) {}
        return { blob: pdf.output("blob"), paginas: pdf.getNumberOfPages() };
      });
  }

  // ---------------- botão + fluxo de envio ----------------
  var css =
    ".btn-wpp{display:flex;width:100%;justify-content:center;align-items:center;gap:8px;margin:8px 0 0;background:#1f9d55;border:1px solid #1f9d55;color:#fff;border-radius:10px;font:inherit;font-weight:700;font-size:14px;padding:12px 16px;cursor:pointer}" +
    ".btn-wpp:hover{background:#188246;border-color:#188246}" +
    ".btn-wpp:disabled{opacity:.6;cursor:default}" +
    ".btn-wpp svg{width:17px;height:17px;flex:none}" +
    ".wpp-box{margin:10px 0 0;font-size:13px;line-height:1.45;color:var(--text-muted,#6b5d4f)}" +
    ".wpp-box[hidden]{display:none!important}" +
    ".wpp-box.err{color:var(--danger,#a6402f)}" +
    ".wpp-box .btn{margin:8px 8px 0 0}" +
    "@media print{.btn-wpp,.wpp-box{display:none!important}}";
  var ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 12 0C5.4 0 .1 5.3.1 11.9c0 2.1.6 4.1 1.6 5.9L0 24l6.4-1.7a11.9 11.9 0 0 0 5.6 1.4h0c6.600 0 11.900-5.300 11.900-11.900 0-3.200-1.200-6.200-3.400-8.300zM12 21.700h0a9.900 9.900 0 0 1-5-1.400l-.4-.2-3.800 1 1-3.700-.2-.4a9.900 9.900 0 0 1-1.500-5.200c0-5.500 4.400-9.900 9.900-9.900 2.600 0 5.100 1 7 2.900a9.800 9.800 0 0 1 2.900 7c0 5.500-4.500 9.900-9.900 9.900zm5.400-7.400c-.3-.1-1.800-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.200-.3.200-.6.100a8 8 0 0 1-4-3.500c-.3-.5.300-.5.900-1.600.1-.2 0-.4 0-.5l-.9-2.200c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.100-.8.400s-1 1-1 2.400 1 2.800 1.200 3c.1.200 2 3.100 4.900 4.300 1.800.8 2.500.8 3.400.7.600-.1 1.800-.7 2-1.400s.3-1.300.2-1.400-.3-.2-.6-.3z"/></svg>';

  GSJ.wpp = {
    // exposto pra teste
    _gerarPdf: gerarPdf, _telefoneWa: telefoneWa, _nomeArquivo: nomeArquivo,

    attach: function (cfg) {
      var btnPrint = document.getElementById("btnPrint");
      if (!btnPrint || document.getElementById("btnWpp")) return;

      if (!document.getElementById("gsjWppCss")) {
        var st = document.createElement("style"); st.id = "gsjWppCss"; st.textContent = css; document.head.appendChild(st);
      }
      var btn = document.createElement("button");
      btn.type = "button"; btn.id = "btnWpp"; btn.className = "btn-wpp";
      var rotulo = ICON + "<span>Enviar no WhatsApp</span>";
      btn.innerHTML = rotulo;
      btnPrint.insertAdjacentElement("afterend", btn);
      var box = document.createElement("div");
      box.className = "wpp-box"; box.id = "wppBox"; box.hidden = true; box.setAttribute("role", "status");
      btn.insertAdjacentElement("afterend", box);

      var pronto = null;           // PDF já gerado (quando o celular exige um novo toque pra compartilhar)
      function setRotulo(t) { btn.querySelector("span").textContent = t; }
      function msg(texto, erro) { box.hidden = !texto; box.className = "wpp-box" + (erro ? " err" : ""); box.textContent = texto || ""; }
      function descartarPronto() { if (pronto) { pronto = null; setRotulo("Enviar no WhatsApp"); } }
      document.addEventListener("input", descartarPronto, true);

      function textoMensagem() {
        var nome = cfg.saudacao === false ? "" : primeiroNome(cfg.cliente && cfg.cliente());
        var ref = cfg.ref && cfg.ref();
        return (nome ? "Olá, " + nome + "! " : "Olá! ") + "Segue o " + cfg.doc.toLowerCase() + (ref ? " (" + ref + ")" : "") +
          " da GSJ Marcenaria & Móveis Planejados. Qualquer dúvida é só me chamar.";
      }
      function linkWa() {
        var tel = telefoneWa(cfg.telefone && cfg.telefone());
        return "https://wa.me/" + tel + "?text=" + encodeURIComponent(textoMensagem());
      }
      function baixar(file) {
        var url = URL.createObjectURL(file);
        var a = document.createElement("a");
        a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }
      function mostrarFallback(file) {
        box.hidden = false; box.className = "wpp-box"; box.textContent = "";
        var p = document.createElement("div");
        p.textContent = "PDF baixado (" + file.name + "). No WhatsApp, toque no clipe 📎, escolha Documento e selecione esse arquivo.";
        var a = document.createElement("a");
        a.className = "btn btn-primary"; a.href = linkWa(); a.target = "_blank"; a.rel = "noopener";
        a.textContent = "Abrir WhatsApp ↗";
        var b = document.createElement("button");
        b.type = "button"; b.className = "btn"; b.textContent = "Baixar de novo";
        b.addEventListener("click", function () { baixar(file); });
        box.appendChild(p); box.appendChild(a); box.appendChild(b);
      }
      function compartilhar(file) {
        var dados = { files: [file], title: file.name, text: textoMensagem() };
        return navigator.share(dados).then(function () {
          msg("Pronto — escolha o contato no WhatsApp para enviar.");
          return true;
        }, function (e) {
          if (e && e.name === "AbortError") { msg(""); return true; }          // fechou a lista, sem erro
          if (e && e.name === "NotAllowedError") {                                // passou muito tempo desde o toque
            pronto = file; setRotulo("Toque para enviar o PDF");
            msg("PDF pronto. Toque no botão verde de novo para escolher o WhatsApp.");
            return true;
          }
          return false;
        });
      }

      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        if (pronto) {                                   // 2º toque: já temos o arquivo, compartilha na hora
          var f = pronto; pronto = null; setRotulo("Enviar no WhatsApp");
          compartilhar(f).then(function (ok) { if (!ok) mostrarFallback(f); });
          return;
        }
        btn.disabled = true; setRotulo("Gerando PDF…"); msg("");
        var cli = cfg.cliente && cfg.cliente();
        var ref = cfg.ref && cfg.ref();
        var nome = nomeArquivo(cfg.doc, cli, ref);
        gerarPdf({ sheet: cfg.sheet, format: cfg.format, margin: cfg.margin, titulo: nome.replace(/\.pdf$/, "") })
          .then(function (r) {
            var file = new File([r.blob], nome, { type: "application/pdf" });
            if (window.GSJ && GSJ.logAction) GSJ.logAction("whatsapp", cfg.key || null, (ref || cli || null));
            var pode = false;
            try { pode = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (e) {}
            if (pode) return compartilhar(file).then(function (ok) { if (!ok) { baixar(file); mostrarFallback(file); } });
            baixar(file); mostrarFallback(file);
          })
          .catch(function (e) { msg("Não deu pra gerar o PDF: " + (e && e.message ? e.message : "erro inesperado"), true); })
          .then(function () { btn.disabled = false; if (!pronto) setRotulo("Enviar no WhatsApp"); });
      });
    }
  };
})();
