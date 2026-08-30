// ======================================
// SAHA CLEANING PAGE
// ======================================

// Selected Service & Package
let selectedService = "";
let selectedPackage = "";

// ======================================
// SERVICE SELECTION
// ======================================

const serviceButtons = document.querySelectorAll(".service-card button");

serviceButtons.forEach(button => {

    button.addEventListener("click", function () {

        serviceButtons.forEach(btn => {

            btn.innerHTML = "Select";
            btn.style.background = "#009966";

        });

        this.innerHTML = "✓ Selected";
        this.style.background = "#00b56f";

        selectedService = this.parentElement.querySelector("h3").innerText;

    });

});

// ======================================
// PACKAGE SELECTION
// ======================================

const packageButtons = document.querySelectorAll(".package-card button");

packageButtons.forEach(button => {

    button.addEventListener("click", function () {

        packageButtons.forEach(btn => {

            btn.innerHTML = "Choose";
            btn.style.background = "#009966";

        });

        this.innerHTML = "✓ Selected";
        this.style.background = "#00b56f";

        selectedPackage = this.parentElement.querySelector("h3").innerText;

    });

});

// ======================================
// BOOKING FORM
// ======================================

const bookingForm = document.querySelector(".booking-form");

bookingForm.addEventListener("submit", function (e) {

    e.preventDefault();

    const name = bookingForm.querySelector('input[placeholder="Full Name"]').value.trim();
    const mobile = bookingForm.querySelector('input[placeholder="Mobile Number"]').value.trim();
    const address = bookingForm.querySelector("textarea").value.trim();
    const date = bookingForm.querySelector('input[type="date"]').value;
    const time = bookingForm.querySelector('input[type="time"]').value;

    if(name===""){

        alert("Please enter your name.");
        return;

    }

    if(mobile.length!=10 || isNaN(mobile)){

        alert("Enter a valid mobile number.");
        return;

    }

    if(address===""){

        alert("Please enter service address.");
        return;

    }

    if(selectedService===""){

        alert("Please select a cleaning service.");
        return;

    }

    if(selectedPackage===""){

        alert("Please choose a package.");
        return;

    }

    if(date==="" || time===""){

        alert("Select booking date and time.");
        return;

    }

    const payment = document.querySelector('input[name="payment"]:checked').parentElement.innerText;

    alert(
`🎉 Booking Confirmed!

Service : ${selectedService}

Package : ${selectedPackage}

Payment : ${payment}

Thank you for choosing SAHA Cleaning Services!`
    );

    window.location = "booking.html";

});

// ======================================
// HERO BUTTON
// ======================================

document.querySelector(".hero button").onclick = () => {

    document.querySelector(".booking-form").scrollIntoView({

        behavior:"smooth"

    });

}

// ======================================
// NOTIFICATION
// ======================================

document.querySelector(".fa-bell").onclick = () => {

    alert("No new notifications.");

}

// ======================================
// CART
// ======================================

document.querySelector(".fa-cart-shopping").onclick = () => {

    window.location = "cart.html";

}

// ======================================
// CARD ANIMATION
// ======================================

const cards = document.querySelectorAll(".service-card,.package-card,.feature,.review-card");

cards.forEach((card,index)=>{

    card.style.opacity="0";
    card.style.transform="translateY(30px)";

    setTimeout(()=>{

        card.style.transition=".5s";
        card.style.opacity="1";
        card.style.transform="translateY(0px)";

    },index*120);

});

// ======================================
// PAGE READY
// ======================================

window.onload=()=>{

    console.log("Cleaning Module Loaded");

}
function addToCart(name,price){


let cart =
JSON.parse(localStorage.getItem("cart")) || [];



cart.push({

name:name,

price:Number(price)

});



localStorage.setItem(

"cart",

JSON.stringify(cart)

);



alert(name+" added to cart");


}