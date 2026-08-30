// =========================
// SAHA HOME PAGE JAVASCRIPT
// =========================

// Notification Count
let notificationCount = 3;

// Cart Count
let cartCount = 0;

// =========================
// Welcome
// =========================

window.onload = () => {

    console.log("Welcome to SAHA");

    animateCards();

    bannerSlider();

};

// =========================
// SEARCH SERVICES
// =========================

const searchInput = document.querySelector(".search-box input");

if(searchInput){

searchInput.addEventListener("keyup",function(){

    let value=this.value.toLowerCase();

    let services=document.querySelectorAll(".service-card");

    services.forEach(service=>{

        let text=service.innerText.toLowerCase();

        if(text.includes(value)){

            service.style.display="block";

        }
        else{

            service.style.display="none";

        }

    });

});

}

// =========================
// SERVICE CLICK
// =========================

let serviceCards=document.querySelectorAll(".service-card");

serviceCards.forEach(card=>{

card.addEventListener("click",()=>{

let service=card.querySelector("h4").innerHTML;

switch(service){

case "Laundry":
window.location="laundry.html";
break;

case "Groceries":
window.location="grocery.html";
break;

case "Cleaning":
window.location="cleaning.html";
break;

case "Repairs":
window.location="repair.html";
break;

case "Electrician":
window.location="electrician.html";
break;

case "Plumber":
window.location="plumber.html";
break;

case "Carpenter":
window.location="carpenter.html";
break;

case "AC Repair":
window.location="acrepair.html";
break;

default:

alert(service);

}

});

});

// =========================
// BOOK BUTTONS
// =========================

let bookBtns=document.querySelectorAll(".popular-card button");

bookBtns.forEach(btn=>{

btn.addEventListener("click",()=>{

window.location="booking.html";

});

});

// =========================
// PRODUCT ADD
// =========================

let addBtns=document.querySelectorAll(".product-card button");

addBtns.forEach(btn=>{

btn.addEventListener("click",()=>{

cartCount++;

btn.innerHTML="Added ✓";

btn.style.background="#00b56f";

setTimeout(()=>{

btn.innerHTML="Add";

},1500);

});

});

// =========================
// PARTNER
// =========================

let join=document.querySelector(".partner-banner button");

if(join){

join.onclick=()=>{

window.location="partner.html";

}

}

// =========================
// PROFILE
// =========================

let user=document.querySelector(".fa-user");

if(user){

user.onclick=()=>{

window.location="profile.html";

}

}

// =========================
// NOTIFICATION
// =========================

let bell=document.querySelector(".fa-bell");

if(bell){

bell.onclick=()=>{

alert("🔔 You have "+notificationCount+" new notifications.");

}

}

// =========================
// CATEGORY CLICK
// =========================

let category=document.querySelectorAll(".category-card");

category.forEach(item=>{

item.onclick=()=>{

window.location="grocery.html";

}

});

// =========================
// SIMPLE BANNER SLIDER
// =========================

function bannerSlider(){

let title=document.querySelector(".banner h1");

let subtitle=document.querySelector(".banner h2");

let offer=[
["20% OFF","Laundry Services"],
["FREE DELIVERY","Groceries"],
["30% OFF","Home Cleaning"],
["Flat ₹200 OFF","AC Repair"]
];

let i=0;

setInterval(()=>{

title.innerHTML=offer[i][0];

subtitle.innerHTML=offer[i][1];

i++;

if(i==offer.length){

i=0;

}

},3000);

}

// =========================
// CARD ANIMATION
// =========================

function animateCards(){

let cards=document.querySelectorAll(".service-card");

cards.forEach((card,index)=>{

card.style.opacity="0";

card.style.transform="translateY(40px)";

setTimeout(()=>{

card.style.transition=".5s";

card.style.opacity="1";

card.style.transform="translateY(0px)";

},index*120);

});

}

// =========================
// BOTTOM NAVIGATION
// =========================

let nav=document.querySelectorAll(".bottom-nav a");

nav.forEach(link=>{

link.onclick=function(){

nav.forEach(x=>x.classList.remove("active"));

this.classList.add("active");

}

});