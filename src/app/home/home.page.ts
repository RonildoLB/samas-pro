import { Component } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonMenu,
  IonButton,
  IonItem,
  IonMenuToggle,
  IonRadio,
  IonRadioGroup,
 } from '@ionic/angular';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonMenu,
    IonButton,
    IonContent,
    IonHeader,
    IonItem,
    IonMenu,
    IonMenuToggle,
    IonRadio,
    IonRadioGroup,
    IonTitle,
    IonToolbar,
  ],
})
export class HomePage {
  constructor() {}
}
