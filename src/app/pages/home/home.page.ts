import { IonAccordion, IonAccordionGroup, IonItem, IonLabel, IonContent, IonProgressBar, IonIcon, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonButton, RefresherCustomEvent, IonRefresherContent, IonRefresher, ToastController } from '@ionic/angular';
import { Component, OnInit, OnDestroy, ChangeDetectorRef, Inject, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { EspService, NodeStatus, SchedulingRaw } from '../../services/esp.service';
import { NodeVisibilityService } from '../../services/node-visibility.service';
import { FormsModule } from '@angular/forms';
import { timer, Subscription, of, timeout, TimeoutError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { settingsOutline, close, trashOutline } from 'ionicons/icons';
import { NgxColorsComponent, NgxColorsTriggerDirective } from 'ngx-colors';
import { SelectModule } from 'primeng/select';

const CANAL2_VISIVEL_PREFIXO = 'samas_canal2_visivel_no_';
const QUANTIDADE_VALVULAS_PREFIXO = 'samas_valvulas_quantidade_no_';
const MAX_VALVULAS = 4;
const COR_VALVULA_PREFIXO = 'samas_cor_valvula_no_';
const TEMPO_PROGRESSO_MS = 5000;
const INTERVALO_STATUS_MS = 5000;
const INTERVALO_RELOGIO_MS = 30_000;

// Chave única por válvula+canal, usada para indexar os mapas de estado otimista.
type Canal = 1 | 2 | 3 | 4;
const CANAIS: Canal[] = [1, 2, 3, 4];

function chaveCanal(idValvula: number, canal: Canal): string {
  return `${idValvula}:${canal}`;
}

// Retorna o próximo minuto múltiplo de 5 a partir de agora, formatado "HH:MM".
// Se o minuto atual já é múltiplo de 5, retorna o PRÓXIMO (ex: às 10:50:30,
// retorna "10:55", pois o minuto 10:50 já está em curso/passado).
function proximoMultiploDe5(): string {
  const agora = new Date();
  const minutosDesdeMeiaNoite = agora.getHours() * 60 + agora.getMinutes();
  const proximo = (Math.floor(minutosDesdeMeiaNoite / 5) + 1) * 5;
  const h = Math.floor(proximo / 60) % 24;
  const m = proximo % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}`;
}

// True quando o relógio local está dentro do minuto múltiplo de 5 em curso
// (ex: entre 10:50:00 e 10:50:59).
function dentroDoMinutoMultiploDe5(): boolean {
  return new Date().getMinutes() % 5 === 0;
}

// INTERFACES
interface AgendamentoPar {
  idLigar?: number;
  idDesligar?: number;
  hrLigar?: number;
  minLigar?: number;
  hrDesligar?: number;
  minDesligar?: number;
  pendente?: boolean;
  removendoPendente?: boolean;
}

interface CanalView {
  canal: Canal;
  estado: boolean;
  agendamentos: AgendamentoPar[];
  loadingLigar: boolean;
  loadingDesligar: boolean;
  novoHoraLigar: string;
  novoHoraDesligar: string;
}

interface ValvulaView {
  id: number;
  nome: string;
  clockAtualizado: boolean;
  clock: string;
  quantidadeValvulas: number;
  canais: CanalView[];
  color: string;
  showConfig: boolean;
}

/*-------------------------------------*/

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonContent, IonButton, FormsModule,
    IonCard, IonCardContent, IonCardHeader, IonCardSubtitle,
    IonCardTitle, IonProgressBar, IonIcon,
    NgxColorsComponent, NgxColorsTriggerDirective, IonAccordion, IonAccordionGroup,
    IonItem, IonLabel, IonRefresherContent, IonRefresher,
    SelectModule],
})

export class HomePage implements OnInit, OnDestroy {
  // VARIÁVEIS
  trash = trashOutline;
  settingsSharpIcon = settingsOutline;
  addIcon = close;
  connected = false;
  valvulas: ValvulaView[] = [];
  dataEsp: string = '';
  horaEsp: string = '';
  ssidEsp: string = '';
  passEsp: string = '';
  horaRecebida: string | null = null;
  hostEsp: string = 'esp.local';
  mostrarRelogioCard: boolean = false;
  proximoHorarioDisponivel: string = proximoMultiploDe5();
  agoraLocal: number = Date.now();
  readonly opcoesQuantidadeValvulas = [
    { label: '1 Válvula', value: '1' },
    { label: '2 Válvulas', value: '2' },
    { label: '3 Válvulas', value: '3' },
    { label: '4 Válvulas', value: '4' },
  ];
  /*----------------------------*/

  private statusSubscription?: Subscription;
  private relogioSubscription?: Subscription;
  private isBrowser: boolean;
  private dentroDaJanelaRelogio: boolean = dentroDoMinutoMultiploDe5();
  private statusConfirmouNosAtivos: boolean = false;
  private adicionadosPendentes = new Map<string, AgendamentoPar[]>();
  private removidosPendentes = new Map<string, Set<number>>();
  private quantidadeValvulasPorNo = new Map<number, number>();

  constructor(
    private esp: EspService,
    private nodeVisibility: NodeVisibilityService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private toastController: ToastController,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  handleRefresh(event: RefresherCustomEvent) {
    setTimeout(() => {
      // Any calls to load data go here
      event.target.complete();
    }, 2000);
  }

  get nodesAcordados(): boolean {
    return this.dentroDaJanelaRelogio || this.statusConfirmouNosAtivos;
  }

  get valvulasVisiveis(): ValvulaView[] {
    return this.valvulas.filter(valvula => this.nodeVisibility.isNodeVisible(valvula.id));
  }

  ngOnInit() {
    this.hostEsp = this.esp.getHost();

    this.statusSubscription = timer(0, INTERVALO_STATUS_MS)
      .pipe(
        switchMap(() => this.esp.getStatus().pipe(
          catchError((err) => {
            console.error('Erro ao buscar status:', err);
            return of(null); // não deixa o erro matar o timer/polling
          })
        ))
      )
      .subscribe((resp: NodeStatus[] | null) => {
        if (resp === null) {
          // /status não respondeu - não temos confirmação de rede de que os
          // nós estão ativos (a janela do relógio, se estiver em curso,
          // continua valendo por conta própria).
          this.statusConfirmouNosAtivos = false;
          this.cdr.detectChanges();
          return;
        }
        // O /status é servido pelo Root, que está sempre ligado - ele
        // responder com sucesso NÃO significa que os nós (que dormem)
        // estão acordados. Só considera confirmado se a lista realmente
        // trouxer pelo menos um nó reportado.
        this.statusConfirmouNosAtivos = Array.isArray(resp) && resp.length > 0;
        this.atualizarValvulas(resp);
      });

    // Atualiza o relógio local, o LED e a janela teórica de despertar a cada 30s.
    this.relogioSubscription = timer(0, INTERVALO_RELOGIO_MS).subscribe(() => {
      this.ngZone.run(() => {
        this.agoraLocal = Date.now();
        this.proximoHorarioDisponivel = proximoMultiploDe5();
        this.dentroDaJanelaRelogio = dentroDoMinutoMultiploDe5();
        this.cdr.detectChanges();
      });
    });
  }

  ngOnDestroy() {
    this.statusSubscription?.unsubscribe();
    this.relogioSubscription?.unsubscribe();
  }

  private atualizarValvulas(lista: NodeStatus[]) {
    this.nodeVisibility.setNodes(lista);
    this.connected = Array.isArray(lista) && lista.length > 0;

    this.valvulas = (lista || []).map((no) => {
      const anterior = this.valvulas.find(v => v.id === no.ID_valve);
      const quantidadeValvulas = anterior?.quantidadeValvulas
        ?? this.lerQuantidadeValvulas(no.ID_valve);
      const estados = [
        no.estado_canal_1,
        no.estado_canal_2,
        no.estado_canal_3,
        no.estado_canal_4,
      ];
      const canais: CanalView[] = CANAIS.map((canal, i) => {
        const canalAnterior = anterior?.canais.find(c => c.canal === canal);
        const agendamentos = (no.schedulings || []).filter(s => s.canal === canal);
        return {
          canal,
          estado: estados[i] === 1,
          agendamentos: this.reconciliarComPendentes(
            no.ID_valve,
            canal,
            this.agruparEmDuplas(agendamentos)
          ),
          loadingLigar: canalAnterior?.loadingLigar ?? false,
          loadingDesligar: canalAnterior?.loadingDesligar ?? false,
          novoHoraLigar: canalAnterior?.novoHoraLigar ?? '',
          novoHoraDesligar: canalAnterior?.novoHoraDesligar ?? '',
        };
      });

      return {
        id: no.ID_valve,
        nome: no.name_valve,
        clockAtualizado: no.clock_updated,
        clock: no.clock,
        quantidadeValvulas,
        canais,
        color: anterior?.color ?? this.lerCorValvula(no.ID_valve),
        showConfig: anterior?.showConfig ?? false,
      };
    });

    this.cdr.detectChanges();
  }

  private reconciliarComPendentes(idValvula: number, canal: Canal, paresReais: AgendamentoPar[]): AgendamentoPar[] {
    const chave = chaveCanal(idValvula, canal);

    // Adição: descarta provisórios cujo id já apareceu na lista real
    const provisorios = this.adicionadosPendentes.get(chave) ?? [];
    if (provisorios.length > 0) {
      const idsReais = new Set(paresReais.flatMap(p => [p.idLigar, p.idDesligar]).filter(id => id !== undefined));
      const aindaProvisorios = provisorios.filter(p =>
        !(p.idLigar !== undefined && idsReais.has(p.idLigar)) &&
        !(p.idDesligar !== undefined && idsReais.has(p.idDesligar))
      );
      if (aindaProvisorios.length !== provisorios.length) {
        this.adicionadosPendentes.set(chave, aindaProvisorios);
      }
    }

    // Remoção: limpa os ids marcados que já não aparecem mais na lista real
    const marcadosRemocao = this.removidosPendentes.get(chave);
    if (marcadosRemocao && marcadosRemocao.size > 0) {
      const idsReais = new Set(paresReais.flatMap(p => [p.idLigar, p.idDesligar]).filter(id => id !== undefined));
      for (const id of Array.from(marcadosRemocao)) {
        if (!idsReais.has(id)) {
          marcadosRemocao.delete(id);
        }
      }
    }

    // Aplica a marca visual de "removendo" nos pares reais ainda pendentes de exclusão
    const paresComMarcaRemocao = paresReais.map(p => {
      const marcado = (p.idLigar !== undefined && marcadosRemocao?.has(p.idLigar)) ||
                      (p.idDesligar !== undefined && marcadosRemocao?.has(p.idDesligar));
      return marcado ? { ...p, removendoPendente: true } : p;
    });

    const provisoriosAtuais = (this.adicionadosPendentes.get(chave) ?? []).map(p => ({ ...p, pendente: true }));
    return [...paresComMarcaRemocao, ...provisoriosAtuais];
  }

  private agruparEmDuplas(lista: SchedulingRaw[]): AgendamentoPar[] {
    const ligar = lista.filter(s => s.dir === 1).sort((a, b) => a.id - b.id);
    const desligar = lista.filter(s => s.dir === 2).sort((a, b) => a.id - b.id);
    const duplas: AgendamentoPar[] = [];

    const total = Math.max(ligar.length, desligar.length);
    for (let i = 0; i < total; i++) {
      const l = ligar[i];
      const d = desligar[i];
      duplas.push({
        idLigar: l?.id,
        idDesligar: d?.id,
        hrLigar: l?.hr,
        minLigar: l?.min,
        hrDesligar: d?.hr,
        minDesligar: d?.min,
      });
    }
    return duplas;
  }

  private lerQuantidadeValvulas(idNo: number): number {
    const emMemoria = this.quantidadeValvulasPorNo.get(idNo);
    if (emMemoria !== undefined) return emMemoria;
    if (!this.isBrowser) return 2;

    const salvo = localStorage.getItem(QUANTIDADE_VALVULAS_PREFIXO + idNo);
    if (salvo !== null) {
      const quantidade = this.normalizarQuantidade(salvo);
      if (quantidade !== undefined) {
        this.quantidadeValvulasPorNo.set(idNo, quantidade);
        return quantidade;
      }
    }

    const legado = localStorage.getItem(CANAL2_VISIVEL_PREFIXO + idNo);
    const quantidade = legado === '0' ? 1 : 2;
    if (legado !== null) {
      localStorage.setItem(QUANTIDADE_VALVULAS_PREFIXO + idNo, String(quantidade));
      localStorage.removeItem(CANAL2_VISIVEL_PREFIXO + idNo);
    }
    this.quantidadeValvulasPorNo.set(idNo, quantidade);
    return quantidade;
  }

  private normalizarQuantidade(valor: unknown): number | undefined {
    const quantidade = Number(valor);
    return Number.isInteger(quantidade) && quantidade >= 1 && quantidade <= MAX_VALVULAS
      ? quantidade
      : undefined;
  }

  letra(canal: number): string {
    return ['A', 'B', 'C', 'D'][canal - 1] ?? canal.toString();
  }

  canaisVisiveis(valvula: ValvulaView): CanalView[] {
    return valvula.canais.slice(0, valvula.quantidadeValvulas);
  }

  private lerCorValvula(idNo: number): string {
    if (!this.isBrowser) return 'green';
    return localStorage.getItem(COR_VALVULA_PREFIXO + idNo) || 'green';
  }

  alternarConfiguracao(valvula: ValvulaView) {
    valvula.showConfig = !valvula.showConfig;
  }

  classeLedClock(
    valvula: Pick<ValvulaView, 'clockAtualizado' | 'clock'>,
    agora: number = Date.now()
  ): 'led-green' | 'led-yellow' | 'led-red' {
    if (!valvula.clockAtualizado) return 'led-red';

    const partes = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(valvula.clock);
    if (!partes) return 'led-red';

    const [, dia, mes, ano, hora, minuto, segundo] = partes.map(Number);
    const horario = new Date(ano, mes - 1, dia, hora, minuto, segundo);
    if (
      horario.getFullYear() !== ano ||
      horario.getMonth() !== mes - 1 ||
      horario.getDate() !== dia ||
      horario.getHours() !== hora ||
      horario.getMinutes() !== minuto ||
      horario.getSeconds() !== segundo
    ) {
      return 'led-red';
    }

    const diferencaMinutos = Math.abs(agora - horario.getTime()) / 60_000;
    if (diferencaMinutos <= 5) return 'led-green';
    if (diferencaMinutos <= 15) return 'led-yellow';
    return 'led-red';
  }

  salvarCorValvula(cor: string, valvula: ValvulaView) {
    valvula.color = cor || 'green';
    if (this.isBrowser) {
      localStorage.setItem(COR_VALVULA_PREFIXO + valvula.id, valvula.color);
    }
    this.cdr.detectChanges();
  }

  alterarQuantidadeValvulas(valor: string, valvula: ValvulaView) {
    const quantidade = this.normalizarQuantidade(valor);
    if (quantidade === undefined || quantidade === valvula.quantidadeValvulas) return;

    valvula.quantidadeValvulas = quantidade;
    this.quantidadeValvulasPorNo.set(valvula.id, quantidade);
    if (this.isBrowser) {
      localStorage.setItem(QUANTIDADE_VALVULAS_PREFIXO + valvula.id, String(quantidade));
    }
    this.cdr.detectChanges();
  }

  acionarMotorProgresso(valvula: ValvulaView, direcao: 'cw' | 'acw', canal: Canal) {
    const canalView = valvula.canais[canal - 1];
    if (this.motorDesabilitado(valvula)) return;

    const loadingKey = direcao === 'cw' ? 'loadingLigar' : 'loadingDesligar';
    canalView[loadingKey] = true;
    this.cdr.detectChanges();
    const idValvula = valvula.id;

    const resetarLoading = () => {
      const atual = this.valvulas.find(v => v.id === idValvula);
      if (atual) atual.canais[canal - 1][loadingKey] = false;
      this.cdr.detectChanges();
    };

    this.esp.pulseMotor(direcao, valvula.id, canal).pipe(
      timeout(5000)
    ).subscribe({
      next: (resp) => {
        console.log(`Motor acionado: no ${valvula.id} canal ${canal} dir ${direcao}`, resp);
        const canalLetra = this.nomeCanal(canal);
        if (this.pulsoFoiAceito(resp)) {
          const acao = direcao === 'cw' ? 'LIGADA' : 'DESLIGADA';
          void this.mostrarToast(
            `A válvula ${valvula.id} - ${canalLetra} foi ${acao}!`,
            'success'
          );
        } else {
          const detalhe = this.detalheRespostaPulso(resp);
          void this.mostrarToast(
            detalhe
              ? `Não foi possível acionar a válvula ${valvula.nome} - canal ${canalLetra}: ${detalhe}`
              : `Não foi possível ${direcao === 'cw' ? 'ligar' : 'desligar'} a válvula ${valvula.nome} - canal ${canalLetra}.`,
            'danger'
          );
        }
        setTimeout(resetarLoading, TEMPO_PROGRESSO_MS);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Erro ao acionar motor:', err);
        const acao = direcao === 'cw' ? 'ligar' : 'desligar';
        void this.mostrarToast(
          err instanceof TimeoutError
            ? `A válvula ${valvula.id} - ${this.nomeCanal(canal)} não confirmou que foi ${direcao === 'cw' ? 'ligada' : 'desligada'}.`
            : `Erro ao ${acao} a válvula ${valvula.id} - ${this.nomeCanal(canal)}. Verifique a conexão e tente novamente.`,
          'danger'
        );
        resetarLoading();
      }
    });
  }

  private nomeCanal(canal: number): string {
    return ['A', 'B', 'C', 'D'][canal - 1] ?? canal.toString();
  }

  private pulsoFoiAceito(resposta: string): boolean {
    const texto = resposta.trim();
    if (!texto) return false;

    let mensagem = texto;
    try {
      const dados: unknown = JSON.parse(texto);
      if (typeof dados === 'boolean') return dados;
      if (typeof dados === 'number') return dados > 0;
      if (typeof dados === 'object' && dados !== null) {
        const resultado = dados as Record<string, unknown>;
        for (const chave of ['success', 'ok', 'accepted']) {
          if (typeof resultado[chave] === 'boolean') return resultado[chave] as boolean;
        }
        const campos = ['status', 'result', 'message', 'msg', 'error', 'detail'];
        mensagem = campos
          .map(chave => resultado[chave])
          .filter((valor): valor is string => typeof valor === 'string')
          .join(' ');
        if (!mensagem) return false;
      } else if (typeof dados === 'string') {
        mensagem = dados;
      }
    } catch {
      // Respostas text/plain do firmware também são válidas.
    }

    const normalizada = mensagem.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/\b(erro|error|fail(?:ed)?|false|invalid|invalido|rejeitad[oa]|recusad[oa]|nao|falh[oa])\b/.test(normalizada)) {
      return false;
    }

    return /\b(ok|success|sucesso|enviado|acionad[oa]|ligad[oa]|desligad[oa]|accepted|true)\b/.test(normalizada);
  }

  private detalheRespostaPulso(resposta: string): string {
    try {
      const dados: unknown = JSON.parse(resposta);
      if (typeof dados === 'string') return dados.trim();
      if (typeof dados === 'object' && dados !== null) {
        const resultado = dados as Record<string, unknown>;
        for (const chave of ['message', 'msg', 'error', 'detail', 'status', 'result']) {
          if (typeof resultado[chave] === 'string' && resultado[chave].trim()) {
            return resultado[chave].trim();
          }
        }
      }
    } catch {
      // Usa a própria resposta quando não for JSON.
    }

    return resposta.trim().slice(0, 160);
  }

  private async mostrarToast(message: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      color,
      duration: 3500,
      position: 'bottom',
    });
    await toast.present();
  }

  motorDesabilitado(valvula: ValvulaView): boolean {
    if (!this.connected || !this.nodesAcordados) return true;
    return valvula.canais.some(c => c.loadingLigar || c.loadingDesligar);
  }

  adicionarAgendamento(valvula: ValvulaView, canal: Canal) {
    const canalView = valvula.canais[canal - 1];
    const horaLigar = canalView.novoHoraLigar;
    const horaDesligar = canalView.novoHoraDesligar;

    if (!horaLigar || !horaDesligar) {
      alert('Preencha os horários de Ligar e Desligar.');
      return;
    }

    const [hrLigar, minLigar] = horaLigar.split(':').map(Number);
    const idLigar = Math.floor(Math.random() * 10000);

    this.esp.adicionarAgendamento(valvula.id, idLigar, hrLigar, minLigar, 1, canal, 1).subscribe(() => {
      const [hrDesligar, minDesligar] = horaDesligar.split(':').map(Number);
      const idDesligar = Math.floor(Math.random() * 10000);

      this.esp.adicionarAgendamento(valvula.id, idDesligar, hrDesligar, minDesligar, 2, canal, 1).subscribe(() => {
        // Confirmado que o Mestre aceitou o pedido - mostra na hora,
        // mesmo antes do nó/mesh confirmarem de fato (só chega no /status
        // depois do próximo ciclo do nó).
        const chave = chaveCanal(valvula.id, canal);
        const provisorios = this.adicionadosPendentes.get(chave) ?? [];
        provisorios.push({
          idLigar, idDesligar,
          hrLigar, minLigar,
          hrDesligar, minDesligar,
        });
        this.adicionadosPendentes.set(chave, provisorios);

        canalView.agendamentos = this.reconciliarComPendentes(
          valvula.id,
          canal,
          canalView.agendamentos.filter(p => !p.pendente)
        );
        canalView.novoHoraLigar = '';
        canalView.novoHoraDesligar = '';
        this.cdr.detectChanges();
      });
    });
  }

  deletarDupla(valvula: ValvulaView, par: AgendamentoPar, canal: Canal) {
    const canalView = valvula.canais[canal - 1];
    const excluirLigar = par.idLigar !== undefined
      ? this.esp.deletarAgendamento(valvula.id, par.idLigar)
      : null;
    const excluirDesligar = par.idDesligar !== undefined
      ? this.esp.deletarAgendamento(valvula.id, par.idDesligar)
      : null;

    const chave = chaveCanal(valvula.id, canal);
    const marcados = this.removidosPendentes.get(chave) ?? new Set<number>();
    if (par.idLigar !== undefined) marcados.add(par.idLigar);
    if (par.idDesligar !== undefined) marcados.add(par.idDesligar);
    this.removidosPendentes.set(chave, marcados);

    // Se o par era provisório (ainda não confirmado pelo /status), já
    // remove da lista de pendentes de adição também.
    const provisorios = this.adicionadosPendentes.get(chave);
    if (provisorios) {
      this.adicionadosPendentes.set(chave, provisorios.filter(p =>
        p.idLigar !== par.idLigar || p.idDesligar !== par.idDesligar
      ));
    }

    canalView.agendamentos = this.reconciliarComPendentes(
      valvula.id,
      canal,
      canalView.agendamentos.filter(p => p !== par || !p.pendente)
    );
    this.cdr.detectChanges();

    const prosseguir = () => {
      if (excluirDesligar) {
        excluirDesligar.subscribe(() => {
          // O proximo ciclo do /status ja vem sem esse par
        });
      }
    };

    if (excluirLigar) {
      excluirLigar.subscribe(() => prosseguir());
    } else {
      prosseguir();
    }
  }

  salvarHost() {
    this.esp.setHost(this.hostEsp);
    this.hostEsp = this.esp.getHost(); // normaliza (ex: campo vazio -> esp.local)
  }

  restaurarHostPadrao() {
    this.esp.setHost('');
    this.hostEsp = this.esp.getHost();
  }

  private formatarHora(h: any): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h.dia)}/${pad(h.mes)}/${h.ano.toString().slice(-2)} ${pad(h.hora)}:${pad(h.min)}:${pad(h.seg)}`;
  }

  enviarDataHora() {
    if (!this.dataEsp || !this.horaEsp) {
      alert('Preencha a data e a hora.');
      return;
    }

    const [ano, mes, dia] = this.dataEsp.split('-').map(Number);
    const [hora, min, seg] = this.horaEsp.split(':').map(Number);
    const s = seg || 0;

    this.esp.setTime(dia, mes, ano, hora, min, s).subscribe(() => {
      console.log('Relógio sincronizado');
      this.lerHoraEsp();
    });
  }

  atualizarWifi() {
    if (!this.ssidEsp || !this.passEsp) {
      alert('Preencha os campos SSID e Senha.');
      return;
    }

    this.esp.setWifi(this.ssidEsp, this.passEsp).subscribe(() => {
      console.log('Wifi atualizado');
    });
  }

  lerHoraEsp() {
    this.esp.getTime().subscribe((t: any) => {
      this.horaRecebida = this.formatarHora(t);
      this.cdr.detectChanges();
    });
  }

}
