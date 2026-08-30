// =========================================
// SAHA LAUNDRY PAGE
// =========================================

// Selected Service & Package
let selectedService = "";
let selectedPackage = "";

// =========================================
// SERVICE SELECTION
// =========================================

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

// =========================================
// PACKAGE SELECTION
// =========================================

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

// =========================================
// BOOKING FORM
// =========================================

const bookingForm = document.querySelector(".booking-form");

bookingForm.addEventListener("submit", function (e) {

    e.preventDefault();

    const name = bookingForm.querySelector('input[placeholder="Full Name"]').value.trim();
    const mobile = bookingForm.querySelector('input[placeholder="Mobile Number"]').value.trim();
    const pickup = bookingForm.querySelector('textarea[placeholder="Pickup Address"]').value.trim();
    const date = bookingForm.querySelector('input[type="date"]').value;
    const time = bookingForm.querySelector('input[type="time"]').value;

    if (name === "") {
        alert("Please enter your name.");
        return;
    }

    if (mobile.length !== 10 || isNaN(mobile)) {
        alert("Please enter a valid 10-digit mobile number.");
        return;
    }

    if (pickup === "") {
        alert("Please enter your pickup address.");
        return;
    }

    if (selectedService === "") {
        alert("Please select a laundry service.");
        return;
    }

    if (selectedPackage === "") {
        alert("Please choose a package.");
        return;
    }

    if (date === "" || time === "") {
        alert("Please select pickup date and time.");
        return;
    }

    const payment = document.querySelector('input[name="payment"]:checked').parentElement.innerText.trim();

    alert(
`🎉 Booking Confirmed!

Customer: ${name}

Service: ${selectedService}

Package: ${selectedPackage}

Payment: ${payment}

Pickup:
${date} at ${time}

Thank you for choosing SAHA!`
    );

    window.location.href = "booking.html";

});

// =========================================
// BOOK PICKUP BUTTON
// =========================================

const bannerButton = document.querySelector(".banner button");

bannerButton.addEventListener("click", () => {

    document.querySelector(".booking-form").scrollIntoView({

        behavior: "smooth"

    });

});

// =========================================
// NOTIFICATION
// =========================================

const bell = document.querySelector(".fa-bell");

if (bell) {

    bell.addEventListener("click", () => {

        alert("🔔 No new notifications.");

    });

}

// =========================================
// CART
// =========================================

const cart = document.querySelector(".fa-cart-shopping");

if (cart) {

    cart.addEventListener("click", () => {

        window.location.href = "cart.html";

    });

}

// =========================================
// CARD ANIMATION
// =========================================

const cards = document.querySelectorAll(".service-card, .package-card");

cards.forEach((card, index) => {

    card.style.opacity = "0";
    card.style.transform = "translateY(30px)";

    setTimeout(() => {

        card.style.transition = "0.5s";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";

    }, index * 120);

});

// =========================================
// BOTTOM NAVIGATION
// =========================================

const navLinks = document.querySelectorAll(".bottom-nav a");

navLinks.forEach(link => {

    link.addEventListener("click", function () {

        navLinks.forEach(item => item.classList.remove("active"));

        this.classList.add("active");

    });

});

// =========================================
// PAGE READY
// =========================================

window.addEventListener("load", () => {

    console.log("SAHA Laundry Page Loaded");

});