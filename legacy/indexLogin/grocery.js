// ======================================
// SAHA GROCERY PAGE
// ======================================

// Cart Count
let cartCount = 0;

// ======================================
// ADD TO CART
// ======================================

const addButtons = document.querySelectorAll(".product-card button");
const cartBadge = document.getElementById("cartCount");

addButtons.forEach(button => {

    button.addEventListener("click", function () {

        cartCount++;

        cartBadge.innerHTML = cartCount;

        this.innerHTML = "Added ✓";
        this.style.background = "#00b56f";

        setTimeout(() => {

            this.innerHTML = "Add";
            this.style.background = "#009966";

        }, 1200);

    });

});

// ======================================
// WISHLIST
// ======================================

const hearts = document.querySelectorAll(".fav i");

hearts.forEach(icon => {

    icon.addEventListener("click", function () {

        this.classList.toggle("fa-solid");
        this.classList.toggle("fa-regular");

        if (this.classList.contains("fa-solid")) {

            this.style.color = "red";

        } else {

            this.style.color = "#555";

        }

    });

});

// ======================================
// SEARCH
// ======================================

const search = document.querySelector(".search-box input");

search.addEventListener("keyup", function () {

    let value = this.value.toLowerCase();

    let products = document.querySelectorAll(".product-card");

    products.forEach(product => {

        let title = product.querySelector("h3").innerText.toLowerCase();

        if (title.includes(value)) {

            product.style.display = "block";

        } else {

            product.style.display = "none";

        }

    });

});

// ======================================
// CATEGORY CLICK
// ======================================

const categories = document.querySelectorAll(".category-card");

categories.forEach(category => {

    category.addEventListener("click", function () {

        alert("Category: " + this.innerText);

    });

});

// ======================================
// FLOATING CART
// ======================================

const floatingCart = document.querySelector(".floating-cart");

floatingCart.addEventListener("click", function () {

    if (cartCount === 0) {

        alert("🛒 Your cart is empty.");

    } else {

        window.location.href = "cart.html";

    }

});

// ======================================
// PRODUCT ANIMATION
// ======================================

const cards = document.querySelectorAll(".product-card");

cards.forEach((card, index) => {

    card.style.opacity = "0";
    card.style.transform = "translateY(30px)";

    setTimeout(() => {

        card.style.transition = "0.5s";
        card.style.opacity = "1";
        card.style.transform = "translateY(0px)";

    }, index * 100);

});

// ======================================
// BOTTOM NAVIGATION
// ======================================

const navLinks = document.querySelectorAll(".bottom-nav a");

navLinks.forEach(link => {

    link.addEventListener("click", function () {

        navLinks.forEach(item => item.classList.remove("active"));

        this.classList.add("active");

    });

});

// ======================================
// PAGE LOAD MESSAGE
// ======================================

window.addEventListener("load", () => {

    console.log("SAHA Grocery Loaded Successfully");

});
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